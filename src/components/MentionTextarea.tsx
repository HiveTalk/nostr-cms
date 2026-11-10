import React, {
  useState,
  useRef,
  useMemo,
  useEffect,
  useDeferredValue,
  useCallback,
  type TextareaHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { nip19 } from 'nostr-tools';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { extractPTags } from '@/lib/mentions';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { useNostrJsonUsers, dedupeUsersByPubkey } from '@/hooks/useNostrJsonUsers';
import { useMentionSearch } from '@/hooks/useMentionSearch';
import { getCaretCoordinates } from '@/lib/caretCoords';

/**
 * A candidate user for the mention dropdown.
 * `label` is what we show; `pubkey` is what we insert (as nostr:npub1...).
 */
interface MentionCandidate {
  pubkey: string;
  npub: string;
  /** Local handle from nostr.json (may be undefined for relay-search results). */
  handle?: string;
  /** Pre-fetched display name from a kind 0 profile (relay search results). */
  displayName?: string;
  /** kind-0 `name` (kept separate from displayName for search). */
  name?: string;
  /** Pre-fetched avatar URL from a kind 0 profile (relay search results). */
  picture?: string;
  /** NIP-05 identifier from search results or author metadata. */
  nip05?: string;
  /** True when the candidate came from relay search rather than nostr.json. */
  external?: boolean;
}

/**
 * Module-level LRU of recently-selected mention users, so re-mentioning
 * someone is instant and survives across editor instances even if the
 * nostr.json source is slow/unavailable. Bounded to keep memory trivial.
 */
const RECENT_LIMIT = 32;
const recentMentions = new Map<string, MentionCandidate>();
function rememberRecent(c: MentionCandidate) {
  // Map preserves insertion order; move-to-end by delete+set.
  recentMentions.delete(c.pubkey);
  recentMentions.set(c.pubkey, c);
  if (recentMentions.size > RECENT_LIMIT) {
    const first = recentMentions.keys().next().value;
    if (first) recentMentions.delete(first);
  }
}

interface MentionTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  /** Fired with `[['p', pubkey], ...]` whenever the set of mentions in the text changes. */
  onMentionsChange?: (tags: string[][]) => void;
}

/** Merge a forwarded ref with an internal ref so both stay in sync. */
function useMergedRef<T>(forwarded: React.Ref<T> | undefined, internal: React.MutableRefObject<T | null>) {
  return useMemo(
    () => (node: T | null) => {
      internal.current = node;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) (forwarded as React.MutableRefObject<T | null>).current = node;
    },
    [forwarded, internal],
  );
}

/** A single row in the dropdown; hoisted so it can read author metadata itself. */
const CandidateRow = React.memo(function CandidateRow({
  candidate,
}: {
  candidate: MentionCandidate;
}) {
  // Always fetch the author profile for external candidates — we need the
  // NIP-05 identifier and avatar even if the search already gave us a name.
  // For local (whitelisted) candidates we already have handle + picture.
  const skipAuthor = !candidate.external && !!(candidate.displayName || candidate.picture);
  const { data: author } = useAuthor(skipAuthor ? undefined : candidate.pubkey);
  const meta = author?.metadata;
  const displayName =
    candidate.displayName ||
    meta?.display_name ||
    meta?.name ||
    candidate.handle ||
    candidate.npub.slice(0, 12);
  const picture = candidate.picture || meta?.picture;
  // Prefer NIP-05 as the sub-label (most identifiable), then handle, then npub.
  const nip05 = candidate.nip05 || meta?.nip05;
  const subLabel = nip05
    ? nip05
    : candidate.handle && candidate.handle !== displayName
      ? `@${candidate.handle}`
      : candidate.npub.slice(0, 16);

  return (
    <div className="flex items-center gap-2 w-full">
      <Avatar className="h-6 w-6 flex-shrink-0">
        <AvatarImage src={picture} />
        <AvatarFallback className="text-[10px]">
          {displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm truncate flex items-center gap-1">
          {displayName}
          {candidate.external && (
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground border rounded px-0.5">
              ext
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground truncate">{subLabel}</span>
      </div>
    </div>
  );
});

export const MentionTextarea = React.forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea({
    value,
    onChange,
    onMentionsChange,
    className,
    ...textareaProps
  }, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useMergedRef(forwardedRef, textareaRef);
  const [mention, setMention] = useState<{
    active: boolean;
    /** Index in `value` where the triggering `@` sits. */
    start: number;
    query: string;
  }>({ active: false, start: 0, query: '' });

  /** Popover anchor (px, relative to textarea's top-left). */
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  /** Highlighted index for keyboard nav within the filtered list. */
  const [activeIdx, setActiveIdx] = useState(0);

  const { data: usersData, isFetching: usersLoading } = useNostrJsonUsers();

  /** Stable candidate pool: nostr.json users + recently-mentioned, deduped. */
  const candidates = useMemo<MentionCandidate[]>(() => {
    const pool: MentionCandidate[] = [];
    if (usersData?.users) {
      for (const u of dedupeUsersByPubkey(usersData.users)) {
        try {
          const npub = nip19.npubEncode(u.pubkey);
          pool.push({ pubkey: u.pubkey, npub, handle: u.name });
        } catch {
          // skip un-encodable pubkeys
        }
      }
    }
    for (const c of recentMentions.values()) {
      if (!pool.some((p) => p.pubkey === c.pubkey)) pool.push(c);
    }
    return pool;
  }, [usersData]);

  const deferredQuery = useDeferredValue(mention.query);

  // Debounce the relay search so we don't fire a NIP-50 query on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    if (!mention.active || deferredQuery.trim().length < 1) {
      setDebouncedSearch('');
      return;
    }
    const id = setTimeout(() => setDebouncedSearch(deferredQuery.trim()), 250);
    return () => clearTimeout(id);
  }, [deferredQuery, mention.active]);

  const { data: searchResults, isFetching: isSearching } = useMentionSearch(debouncedSearch);

  // True while typed text hasn't reached the search yet — either still in
  // the 250ms debounce window or a fetch is in flight. Gates "No matching
  // users" so it can't flash between keystrokes/requests.
  const searchPending = isSearching || deferredQuery.trim() !== debouncedSearch;

  // The whitelist (nostr.json) pool loads async on its own — "No matching
  // users" can't be trusted until it has settled too, or a late-arriving
  // local match pops in right after the verdict.
  const poolsPending = usersLoading;

  // Grace period before showing "No matching users": an intermediate prefix
  // can settle with zero results while the user is still typing toward the
  // real query — show the verdict only once the query has been stable and
  // fully searched for a beat.
  const [showNoMatch, setShowNoMatch] = useState(false);
  useEffect(() => {
    setShowNoMatch(false);
    if (searchPending || poolsPending || !deferredQuery.trim()) return;
    const id = setTimeout(() => setShowNoMatch(true), 400);
    return () => clearTimeout(id);
  }, [searchPending, poolsPending, deferredQuery]);

  /** External candidates from relay search, mapped to MentionCandidate shape. */
  const externalCandidates = useMemo<MentionCandidate[]>(() => {
    if (!searchResults) return [];
    const seen = new Set(candidates.map((c) => c.pubkey));
    const external = searchResults
      .filter((r) => !seen.has(r.pubkey))
      .map((r) => ({
        pubkey: r.pubkey,
        npub: r.npub,
        displayName: r.displayName || r.name,
        name: r.name,
        picture: r.picture,
        nip05: r.nip05,
        external: true,
      }));
    return external;
  }, [searchResults, candidates]);

  /** Filtered, memoized list — local pool first, then external search results. */
  const filtered = useMemo<MentionCandidate[]>(() => {
    if (!mention.active) return [];
    const q = deferredQuery.trim().toLowerCase();
    const match = (c: MentionCandidate) => {
      const handle = (c.handle || '').toLowerCase();
      const name = (c.displayName || '').toLowerCase();
      const nip05 = (c.nip05 || '').toLowerCase();
      // Complete bech32 identities (npub1… / nprofile1…, optionally
      // nostr:-prefixed) match by decoded pubkey — the resolved user may
      // carry no name fields at all. Partial strings never decode, so
      // substring noise stays out.
      if (/^(nostr:)?(npub1|nprofile1)/i.test(q)) {
        try {
          const decoded = nip19.decode(q.replace(/^nostr:/, ''));
          const pk =
            decoded.type === 'npub' ? decoded.data
            : decoded.type === 'nprofile' ? decoded.data.pubkey
            : '';
          if (pk === c.pubkey) return true;
        } catch {
          // not a complete/valid entity — fall through to text match
        }
      }
      return handle.includes(q) || name.includes(q) || (c.name || '').toLowerCase().includes(q) || nip05.includes(q);
    };

    if (!q) return candidates.slice(0, 20);

    const local = candidates.filter(match);
    const external = externalCandidates.filter(match);
    // Local (whitelisted) results first, then external.
    return [...local, ...external];
  }, [candidates, externalCandidates, deferredQuery, mention.active]);

  // Keep highlighted index in range as the filtered list changes.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  /** Fire p-tags upstream whenever the mention set in `value` changes. */
  const lastTagsRef = useRef<string>('');
  const emitMentions = useCallback(
    (content: string) => {
      if (!onMentionsChange) return;
      const tags = extractPTags(content);
      const key = tags.map((t) => t.join(':')).join('|');
      if (key !== lastTagsRef.current) {
        lastTagsRef.current = key;
        onMentionsChange(tags);
      }
    },
    [onMentionsChange],
  );

  /** Detect mention mode from the caret position: a `@` at a word boundary. */
  const detectMention = useCallback(
    (text: string, caret: number) => {
      // Walk back from the caret to find an unbroken `@...` token.
      let i = caret;
      while (i > 0) {
        const ch = text[i - 1];
        if (ch === '@') {
          // Must be at a word boundary: preceded by start, whitespace, or nothing.
          const prev = text[i - 2];
          if (i - 2 < 0 || /\s/.test(prev)) {
            const query = text.slice(i, caret);
            // Query must not contain whitespace (closes the mention).
            if (!/\s/.test(query)) {
              return { active: true, start: i - 1, query };
            }
            // Whitespace after the trigger @ → not a mention, stop.
            return { active: false, start: 0, query: '' };
          }
          // This @ is not at a word boundary (e.g. the @ inside a NIP-05
          // like `@alex@gleasonator.com`). Keep walking back to find the
          // actual trigger @ rather than bailing — the query's whitespace
          // check above still guards against stray @s in prose.
          i--;
          continue;
        }
        if (/\s/.test(ch)) break;
        i--;
      }
      return { active: false, start: 0, query: '' };
    },
    [],
  );

  /** Update dropdown position from the caret, offset by one line height. */
  const updateCoords = useCallback((caret: number) => {
    if (!textareaRef.current) return;
    const c = getCaretCoordinates(textareaRef.current, caret);
    setCoords({ top: c.top + c.lineHeight + 4, left: c.left });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const caret = e.target.selectionStart ?? next.length;
    const m = detectMention(next, caret);
    if (m.active) updateCoords(caret);
    setMention(m);
    setActiveIdx(0);
    onChange(next);
    emitMentions(next);
  };

  const handleSelect = useCallback(
    (candidate: MentionCandidate) => {
      if (!textareaRef.current) return;
      const { start } = mention;
      const caret = textareaRef.current.selectionStart ?? value.length;
      // Replace `@query` with `nostr:npub1...` and a trailing space.
      const before = value.slice(0, start);
      const after = value.slice(caret);
      const inserted = `nostr:${candidate.npub} `;
      const next = before + inserted + after;
      onChange(next);
      emitMentions(next);
      rememberRecent(candidate);
      setMention({ active: false, start: 0, query: '' });
      setCoords(null);
      // Restore focus and place caret after the inserted mention.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        const pos = before.length + inserted.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [mention, value, onChange, emitMentions],
  );

  const closeMention = useCallback(() => {
    setMention({ active: false, start: 0, query: '' });
    setCoords(null);
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.active && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelect(filtered[activeIdx]);
        return;
      }
    }
    if (mention.active && e.key === 'Escape') {
      e.preventDefault();
      closeMention();
      return;
    }
    textareaProps.onKeyDown?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    // Delay close so a click on a candidate row registers first.
    setTimeout(() => closeMention(), 120);
    textareaProps.onBlur?.(e);
  };

  // Update query as the user types within an active mention (caret moves).
  // We re-derive on selection/click too via handleSelect/click handlers.
  const handleKeyUp = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.active && textareaRef.current) {
      const caret = textareaRef.current.selectionStart ?? value.length;
      const m = detectMention(value, caret);
      if (m.active) {
        if (m.query !== mention.query) {
          updateCoords(caret);
          setMention(m);
          setActiveIdx(0);
        }
      } else {
        closeMention();
      }
    }
    textareaProps.onKeyUp?.(e);
  };

  const handleClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (textareaRef.current) {
      const caret = textareaRef.current.selectionStart ?? value.length;
      const m = detectMention(value, caret);
      if (m.active) updateCoords(caret);
      setMention(m);
      setActiveIdx(0);
    }
    textareaProps.onClick?.(e);
  };

  // Show the dropdown whenever mention mode is active and we have coords,
  // even if the list is empty — the user needs to see "Searching..." or
  // "No matching users" feedback, and external search results may arrive later.
  const open = mention.active && coords !== null;

  return (
    <div className="relative">
      <Textarea
        {...textareaProps}
        ref={setRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleClick}
        onBlur={handleBlur}
        className={className}
      />
      {open &&
        createPortal(
          <div
            className="fixed z-50 w-72 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95"
            style={{
              // Position relative to the textarea's viewport rect.
              top: textareaRef.current
                ? textareaRef.current.getBoundingClientRect().top + coords!.top
                : 0,
              left: textareaRef.current
                ? textareaRef.current.getBoundingClientRect().left + coords!.left
                : 0,
            }}
            role="listbox"
          >
            {filtered.length === 0 ? (
              <div className="py-3 text-center text-sm text-muted-foreground">
                {!deferredQuery.trim()
                  ? 'Type a name to search…'
                  : showNoMatch
                    ? 'No matching users'
                    : 'Searching relays…'}
              </div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c.pubkey}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before click fires.
                    e.preventDefault();
                  }}
                  onClick={() => handleSelect(c)}
                  className={cn(
                    'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors',
                    i === activeIdx
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <CandidateRow candidate={c} />
                </button>
              ))
            )}
            {searchPending && filtered.length > 0 && (
              <div className="py-2 text-center text-xs text-muted-foreground">
                Searching relays…
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
},
);
