import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { nip19 } from 'nostr-tools';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { AuthorInfo } from '@/components/AuthorInfo';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDefaultRelay } from '@/hooks/useDefaultRelay';
import { useToast } from '@/hooks/useToast';
import { getMasterPubkey, getSwarmAdminApiUrl } from '@/lib/relay';
import { nip98Fetch } from '@/lib/nip98';
import { useAdminAuth } from '@/hooks/useRemoteNostrJson';
import { RefreshCw, Search, ChevronRight, Eye, X, Copy, ChevronDown, Repeat2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { kindLabel, categorizeKinds } from '@/lib/kinds';
import { isAddressableKind } from '@/lib/nip19';

// ---- Types ----

interface RelayStats {
  totalEvents: number;
  uniquePubkeys: number;
  byKind: Record<string, number>;
  byPubkey: Record<string, number>;
  knownPubkeys: Record<string, string>;
  ownerPubkey: string;
}

interface EventSummary {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

interface EventsResponse {
  events: EventSummary[];
  count: number;
  limit: number;
}

// ---- Helpers ----

function npubFromHex(hex: string): string {
  try {
    if (hex && /^[0-9a-f]{64}$/.test(hex)) return nip19.npubEncode(hex);
  } catch { /* ignore */ }
  return '';
}

function shortPubkey(hex: string): string {
  if (!hex) return '';
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

function noteIdFromHex(hex: string): string {
  try {
    if (hex && /^[0-9a-f]{64}$/.test(hex)) return nip19.noteEncode(hex);
  } catch { /* ignore */ }
  return '';
}

function naddrFromEvent(evt: EventSummary): string | null {
  try {
    const dTag = evt.tags.find(t => t[0] === 'd');
    if (!dTag) return null;
    if (!isAddressableKind(evt.kind)) return null;
    return nip19.naddrEncode({
      kind: evt.kind,
      pubkey: evt.pubkey,
      identifier: dTag[1],
    });
  } catch { return null; }
}

function extractMediaFromEvent(evt: EventSummary): { url: string; isVideo: boolean } | null {
  // Check imeta tags first (NIP-92)
  for (const tag of evt.tags) {
    if (tag[0] === 'imeta') {
      const urlLine = tag.find(t => typeof t === 'string' && t.startsWith('url '));
      if (typeof urlLine === 'string') {
        const url = urlLine.slice(4);
        if (url) {
          const isVideo = /\.(mp4|webm|ogg|mov|m4v)$/i.test(url);
          const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
          if (isImage || isVideo) return { url, isVideo };
        }
      }
    }
  }

  // Fallback: scan content for image/video URLs
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(evt.content)) !== null) {
    const url = match[1].replace(/[.,;!?]$/, '');
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url)) return { url, isVideo: false };
    if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(url)) return { url, isVideo: true };
  }

  return null;
}

function extractFirstUrl(evt: EventSummary): string | null {
  const match = evt.content.match(/(https?:\/\/[^\s]+)/i);
  return match ? match[1].replace(/[.,;!?]$/, '') : null;
}

// ---- API helpers ----

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  return text || `${response.status} ${response.statusText}`;
}

function buildRelayFilter(selectedKinds: number[], authorFilter: string, limit: number) {
  const filter: { kinds?: number[]; authors?: string[]; limit: number } = { limit };
  if (selectedKinds.length > 0) filter.kinds = selectedKinds;
  if (authorFilter) filter.authors = [authorFilter];
  return filter;
}

function statsFromEvents(events: EventSummary[]): RelayStats {
  const byKind: Record<string, number> = {};
  const byPubkey: Record<string, number> = {};
  for (const event of events) {
    byKind[String(event.kind)] = (byKind[String(event.kind)] || 0) + 1;
    byPubkey[event.pubkey] = (byPubkey[event.pubkey] || 0) + 1;
  }
  return {
    totalEvents: events.length,
    uniquePubkeys: Object.keys(byPubkey).length,
    byKind,
    byPubkey,
    knownPubkeys: {},
    ownerPubkey: getMasterPubkey(),
  };
}

function useAdminApi() {
  const { user } = useCurrentUser();
  const { nostr } = useDefaultRelay();

  const adminApiBase = getSwarmAdminApiUrl();
  const adminApiBases = useMemo(() => {
    const primary = adminApiBase.replace(/\/$/, '');
    const legacy = primary.endsWith('/admin')
      ? `${primary.slice(0, -'/admin'.length)}/dashboard`
      : '';
    return legacy && legacy !== primary ? [primary, legacy] : [primary];
  }, [adminApiBase]);

  // Each request is individually NIP-98-signed by the user's signer —
  // replaces the cookie-session flow (which POSTed a bare pubkey to /login
  // with no proof of key possession).
  //
  // Backends that predate NIP-98 admin auth reject signed requests with 401 —
  // fall back to the session-cookie flow so the panel keeps working until the
  // relay is upgraded. The mode is remembered per base so legacy backends
  // don't trigger a signing prompt on every request.
  const sessionBackedBases = useRef<Set<string>>(new Set());

  const ensureAdminSession = useCallback(async (base: string): Promise<void> => {
    if (!user?.pubkey) throw new Error('Please login with the primary owner key first');

    // Current backend: challenge -> sign a kind-27235 event whose content is
    // the challenge -> POST {event} to establish the session cookie.
    try {
      const challengeResponse = await fetch(`${base}/challenge`, { credentials: 'include' });
      if (challengeResponse.ok) {
        const { challenge, kind } = (await challengeResponse.json()) as { challenge?: string; kind?: number };
        if (challenge) {
          const event = await user.signer.signEvent({
            kind: kind ?? 27235,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: challenge,
          });
          const loginResponse = await fetch(`${base}/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event }),
          });
          if (loginResponse.ok) return;
        }
      }
    } catch {
      // Fall through to the legacy login below.
    }

    // Legacy backend predating challenge login: bare pubkey POST.
    const loginResponse = await fetch(`${base}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: user.pubkey.toLowerCase().trim() }),
    });
    if (!loginResponse.ok) throw new Error(await parseError(loginResponse));
  }, [user]);

  const fetchAdminApi = useCallback(async (path: string): Promise<Response> => {
    if (!user) throw new Error('Please login with the primary owner key first');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    for (let index = 0; index < adminApiBases.length; index++) {
      const base = adminApiBases[index];
      let response: Response;
      if (sessionBackedBases.current.has(base)) {
        response = await fetch(`${base}${normalizedPath}`, { credentials: 'include' });
        if (response.status === 401) {
          await ensureAdminSession(base);
          response = await fetch(`${base}${normalizedPath}`, { credentials: 'include' });
        }
      } else {
        response = await nip98Fetch(`${base}${normalizedPath}`, {}, user);
        if (response.status === 401) {
          await ensureAdminSession(base);
          response = await fetch(`${base}${normalizedPath}`, { credentials: 'include' });
          if (response.status !== 401) sessionBackedBases.current.add(base);
        }
      }
      if (response.status !== 404 || index === adminApiBases.length - 1) return response;
    }
    throw new Error('Unable to reach relay admin API');
  }, [adminApiBases, ensureAdminSession, user]);

  return { fetchAdminApi, nostr, user };
}

// ---- Author display (username, not hex) ----

function AuthorName({ pubkey, size = 'sm' }: { pubkey: string; size?: 'sm' | 'md' }) {
  return <AuthorInfo pubkey={pubkey} className="flex items-center gap-1.5" size={size} />;
}

// ---- Stats Section ----

function StatsOverview({ stats, isLoading }: {
  stats?: RelayStats;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Failed to load stats. Make sure you are logged in as the relay operator.
        </CardContent>
      </Card>
    );
  }

  const categories = categorizeKinds(stats.byKind);

  // Find specific category counts for cards
  const notesCount = categories.find(c => c.label === 'Notes')?.count ?? 0;
  const repostsCount = categories.find(c => c.label === 'Reposts')?.count ?? 0;
  const articlesCount = categories.find(c => c.label === 'Articles')?.count ?? 0;
  const othersCount = categories.find(c => c.label === 'Other')?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalEvents.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground whitespace-nowrap">Unique Pubkeys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.uniquePubkeys.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{notesCount.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reposts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{repostsCount.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Articles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{articlesCount.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Others</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{othersCount.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Pubkey breakdown — moved to its own component below Event Browser */}
    </div>
  );
}

function PubkeyBreakdown({ stats }: { stats: RelayStats }) {
  const [expanded, setExpanded] = useState(false);
  const sortedPubkeys = Object.entries(stats.byPubkey).sort((a, b) => b[1] - a[1]);
  const TOP_N = 5;
  const visiblePubkeys = expanded ? sortedPubkeys : sortedPubkeys.slice(0, TOP_N);
  const hiddenCount = sortedPubkeys.length - TOP_N;

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left w-full"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`} />
          <CardTitle className="text-lg">Events by Pubkey</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {sortedPubkeys.length} users
          </Badge>
        </button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[250px]">User</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="w-[200px] min-w-[200px]">Distribution</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiblePubkeys.map(([pubkey, count]) => {
              const name = stats.knownPubkeys[pubkey] || '';
              const isKnown = !!name;
              const pct = stats.totalEvents > 0 ? (count / stats.totalEvents) * 100 : 0;
              return (
                <TableRow key={pubkey}>
                  <TableCell>
                    <AuthorName pubkey={pubkey} />
                  </TableCell>
                  <TableCell>
                    {pubkey === stats.ownerPubkey ? (
                      <Badge>Primary (Owner)</Badge>
                    ) : isKnown ? (
                      <Badge variant="secondary">Secondary (Team)</Badge>
                    ) : (
                      <Badge variant="outline">External</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{count.toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full mt-3"
          >
            {expanded ? 'Show less' : `Show ${hiddenCount} more`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Reposted Note Preview ----

/** Try to extract the original event from a repost's content (some clients embed it as JSON). */
function parseEmbeddedEvent(content: string): EventSummary | null {
  if (!content || !content.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed.id && parsed.pubkey && typeof parsed.kind === 'number') {
      return {
        id: parsed.id,
        pubkey: parsed.pubkey,
        kind: parsed.kind,
        created_at: parsed.created_at || 0,
        content: parsed.content || '',
        tags: parsed.tags || [],
      };
    }
  } catch { /* not valid JSON */ }
  return null;
}

/** Extract the referenced event ID from a repost's e-tag. */
function getRepostedEventId(event: EventSummary): string | null {
  const eTag = event.tags.find(t => t[0] === 'e');
  return eTag?.[1] || null;
}

/** Extract the referenced pubkey from a repost's p-tag. */
function getRepostedPubkey(event: EventSummary): string | null {
  const pTag = event.tags.find(t => t[0] === 'p');
  return pTag?.[1] || null;
}

function RepostedNote({ repostEvent }: { repostEvent: EventSummary }) {
  const { nostr } = useDefaultRelay();
  const [originalEvent, setOriginalEvent] = useState<EventSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    // First try to parse the embedded event from content
    const embedded = parseEmbeddedEvent(repostEvent.content);
    if (embedded) {
      setOriginalEvent(embedded);
      setLoading(false);
      return;
    }

    // Otherwise fetch from relay via WebSocket using the e-tag
    const eventId = getRepostedEventId(repostEvent);
    if (!eventId || !nostr) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    let cancelled = false;
    const signal = AbortSignal.timeout(5000);

    nostr.query([{ ids: [eventId] }], { signal })
      .then(events => {
        if (cancelled) return;
        if (events.length > 0) {
          const e = events[0];
          setOriginalEvent({
            id: e.id,
            pubkey: e.pubkey,
            kind: e.kind,
            created_at: e.created_at,
            content: e.content,
            tags: e.tags,
          });
        } else {
          setNotFound(true);
        }
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [repostEvent, nostr]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading reposted note...
      </div>
    );
  }

  if (notFound || !originalEvent) {
    const referencedId = getRepostedEventId(repostEvent);
    const referencedPubkey = getRepostedPubkey(repostEvent);
    return (
      <div className="p-3 bg-muted/50 rounded-md text-sm text-muted-foreground space-y-1">
        <p>Original event not found on this relay.</p>
        {referencedPubkey && (
          <div className="flex items-center gap-2">
            <span>Original author:</span>
            <AuthorName pubkey={referencedPubkey} />
          </div>
        )}
        {referencedId && (
          <div className="flex items-center gap-2">
            <span>Event ID:</span>
            <code className="text-xs break-all">{noteIdFromHex(referencedId) || referencedId.slice(0, 24) + '...'}</code>
          </div>
        )}
      </div>
    );
  }

  const media = extractMediaFromEvent(originalEvent);
  const originalNoteId = noteIdFromHex(originalEvent.id);

  return (
    <div className="border-l-4 border-primary/30 pl-4 space-y-3">
      {/* Original author header */}
      <div className="flex items-center gap-2">
        <Repeat2 className="h-4 w-4 text-primary/60" />
        <span className="text-xs font-medium text-muted-foreground">Reposted from</span>
        <AuthorName pubkey={originalEvent.pubkey} />
        <Badge variant="outline" className="text-xs">{kindLabel(originalEvent.kind)}</Badge>
        <span className="text-xs text-muted-foreground">
          {new Date(originalEvent.created_at * 1000).toLocaleDateString()}
        </span>
      </div>

      {/* Original media */}
      {media && (
        <div className="rounded-lg overflow-hidden border">
          {media.isVideo ? (
            <video src={media.url} controls preload="metadata" className="w-full max-h-48 object-contain" />
          ) : (
            <img src={media.url} alt="" referrerPolicy="no-referrer" className="w-full max-h-48 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
      )}

      {/* Original content */}
      {originalEvent.content && (
        <pre className="p-3 bg-muted/50 rounded-md text-sm whitespace-pre-wrap break-words max-h-40 overflow-auto">{originalEvent.content}</pre>
      )}

      {/* Original note ID */}
      {originalNoteId && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Original note:</span>
          <code className="text-xs bg-muted px-2 py-0.5 rounded truncate flex-1">{originalNoteId}</code>
        </div>
      )}
    </div>
  );
}

// ---- Event Preview Dialog ----

function EventPreview({ event, onClose, onFilterAuthor }: {
  event: EventSummary;
  onClose: () => void;
  onFilterAuthor: (pubkey: string) => void;
}) {
  const { toast } = useToast();
  const media = extractMediaFromEvent(event);
  const firstUrl = extractFirstUrl(event);
  const noteId = noteIdFromHex(event.id);
  const naddr = naddrFromEvent(event);
  const nostrId = naddr || noteId;
  const npub = npubFromHex(event.pubkey);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copied`, description: text.slice(0, 50) + '...' });
    }).catch(() => {
      toast({ title: 'Failed to copy', variant: 'destructive' });
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="max-w-full w-full sm:max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Event Preview</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Author */}
          <div className="flex items-center gap-3">
            <AuthorName pubkey={event.pubkey} size="md" />
            <Badge variant="outline">{kindLabel(event.kind)}</Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(event.created_at * 1000).toLocaleString()}
            </span>
          </div>

          {/* Reposted note preview (for kind 6 / 16) */}
          {(event.kind === 6 || event.kind === 16) && (
            <RepostedNote repostEvent={event} />
          )}

          {/* Media thumbnail */}
          {media && (
            <div className="rounded-lg overflow-hidden border">
              {media.isVideo ? (
                <video src={media.url} controls preload="metadata" className="w-full max-h-64 object-contain" />
              ) : (
                <img src={media.url} alt="" referrerPolicy="no-referrer" className="w-full max-h-64 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              )}
            </div>
          )}

          {/* Content */}
          {event.content && (
            <div>
              <Label className="text-xs text-muted-foreground">Content</Label>
              <pre className="mt-1 p-3 bg-muted rounded-md text-sm whitespace-pre-wrap break-words max-h-48 overflow-auto">{event.content}</pre>
            </div>
          )}

          {/* Link to content if no media but has URL */}
          {!media && firstUrl && (
            <a href={firstUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-sm break-all">
              {firstUrl}
            </a>
          )}

          {/* Nostr ID with copy button */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Nostr ID:</Label>
            <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">{nostrId || event.id}</code>
            <Button variant="outline" size="icon" onClick={() => copyToClipboard(nostrId || event.id, 'Nostr ID')}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { onFilterAuthor(event.pubkey); onClose(); }}
            >
              <Search className="h-4 w-4 mr-1" /> Filter by this author
            </Button>
          </div>

          {/* Technical details (collapsed) */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span>Technical details</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              {/* Hex IDs */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap w-16">Event ID:</Label>
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">{event.id}</code>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(event.id, 'Event ID')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap w-16">Pubkey:</Label>
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">{event.pubkey}</code>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(event.pubkey, 'Pubkey')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                {npub && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap w-16">npub:</Label>
                    <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">{npub}</code>
                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(npub, 'npub')}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div>
                <Label className="text-xs text-muted-foreground">Tags ({event.tags.length})</Label>
                <pre className="mt-1 p-3 bg-muted rounded-md text-xs whitespace-pre-wrap break-all max-h-48 overflow-auto">{JSON.stringify(event.tags, null, 2)}</pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Event Browser Section ----

function EventBrowser({ stats, authorFilter, setAuthorFilter }: {
  stats?: RelayStats;
  authorFilter: string;
  setAuthorFilter: (pubkey: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { fetchAdminApi, nostr } = useAdminApi();

  // selectedKinds: empty array means "all kinds". When non-empty, only
  // those kinds are queried. All available kinds are ticked on by default.
  const [selectedKinds, setSelectedKinds] = useState<number[]>([]);
  const [limit, setLimit] = useState(50);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedKinds.length > 0) params.set('kinds', selectedKinds.join(','));
    if (authorFilter) params.set('author', authorFilter);
    params.set('limit', String(limit));
    return params.toString();
  }, [selectedKinds, authorFilter, limit]);

  const { data: eventsData, isLoading, error } = useQuery({
    queryKey: ['relay-explorer-events', selectedKinds, authorFilter, limit],
    queryFn: async () => {
      try {
        const response = await fetchAdminApi(`/events?${queryParams}`);
        if (response.ok) return response.json() as Promise<EventsResponse>;
        if (response.status !== 404 && response.status !== 401) {
          throw new Error(await parseError(response));
        }
      } catch (error) {
        if (!nostr) throw error;
      }

      if (!nostr) throw new Error('Relay connection is unavailable');
      const relayEvents = await nostr.query([buildRelayFilter(selectedKinds, authorFilter, limit)], {
        signal: AbortSignal.timeout(15000),
      });
      const events = relayEvents
        .sort((a, b) => b.created_at - a.created_at)
        .map(({ id, pubkey, kind, created_at, content, tags }) => ({
          id, pubkey, kind, created_at, content, tags,
        }));
      return { events, count: events.length, limit };
    },
  });

  const events = eventsData?.events || [];
  const hasMore = events.length === limit;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['relay-explorer-events'] });
  };

  const errorShownRef = useRef(false);
  useEffect(() => {
    if (error && !errorShownRef.current) {
      errorShownRef.current = true;
      toast({ title: 'Error loading events', description: String(error), variant: 'destructive' });
    }
    if (!error) {
      errorShownRef.current = false;
    }
  }, [error]);

  // Build kind filter options from the stats response, sorted by kind number.
  const availableKinds = stats ? Object.keys(stats.byKind).map(Number).sort((a, b) => a - b) : [];

  // Toggle a kind in the selectedKinds array.
  // Empty array = "all kinds" (no filter sent to backend).
  // Unchecking a kind from the "all" state materializes the full list
  // minus that kind. Checking the last unchecked kind collapses back
  // to empty (= all). Unchecking the last checked kind also collapses
  // back to empty (= all) to avoid a "show nothing" state.
  const toggleKind = (kind: number) => {
    setSelectedKinds(prev => {
      if (prev.length === 0) {
        // "All" state → unchecking: materialize all except this one
        return availableKinds.filter(k => k !== kind);
      }
      if (prev.includes(kind)) {
        const next = prev.filter(k => k !== kind);
        // Collapsing back to "all" when nothing is checked
        return next.length === 0 ? [] : next;
      } else {
        const next = [...prev, kind];
        // Collapsing back to "all" when everything is checked
        return next.length === availableKinds.length ? [] : next;
      }
    });
  };

  // Label for the kind filter trigger button.
  const kindFilterLabel = selectedKinds.length === 0
    ? 'All kinds'
    : selectedKinds.length === 1
      ? `${selectedKinds[0]} — ${kindLabel(selectedKinds[0])}`
      : `${selectedKinds.length} kinds selected`;

  // Build author filter options from stats byPubkey + knownPubkeys
  const availableAuthors = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byPubkey)
      .map(([pubkey, count]) => ({
        pubkey,
        name: stats.knownPubkeys[pubkey] || '',
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Event Browser</CardTitle>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-[220px] justify-between font-normal">
                  {kindFilterLabel}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="start">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {selectedKinds.length === 0
                      ? `All ${availableKinds.length} kinds`
                      : `${selectedKinds.length} of ${availableKinds.length} selected`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setSelectedKinds([])}
                    disabled={selectedKinds.length === 0}
                  >
                    Reset to all
                  </Button>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {availableKinds.map(k => {
                    const checked = selectedKinds.length === 0 || selectedKinds.includes(k);
                    const count = stats?.byKind[String(k)] ?? 0;
                    return (
                      <div
                        key={k}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer"
                        onClick={() => toggleKind(k)}
                      >
                        <Checkbox checked={checked} />
                        <span className="text-sm flex-1">
                          {k} — {kindLabel(k)}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Author</Label>
            <Select value={authorFilter || 'all'} onValueChange={(v) => setAuthorFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All authors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All authors</SelectItem>
                {availableAuthors.map(({ pubkey, name, count }) => (
                  <SelectItem key={pubkey} value={pubkey}>
                    {name && name !== '_' ? name : shortPubkey(pubkey)} ({count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Page size</Label>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Events table — no horizontal scroll, truncated columns */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No events found matching filters.</div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[70px]">Kind</TableHead>
                    <TableHead className="w-[180px]">Author</TableHead>
                    <TableHead className="w-[160px]">Created</TableHead>
                    <TableHead className="max-w-[300px]">Content</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((evt) => (
                    <TableRow key={evt.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedEvent(evt)}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{evt.kind}</Badge>
                      </TableCell>
                      <TableCell>
                        <AuthorName pubkey={evt.pubkey} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(evt.created_at * 1000).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="truncate max-w-[300px]">{evt.content || <span className="italic">(no content)</span>}</div>
                      </TableCell>
                      <TableCell>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Showing {events.length} events{hasMore ? ' (may have more)' : ''}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore}
                onClick={() => setLimit(Math.min(limit * 2, 500))}
              >
                Load more <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {/* Event preview dialog */}
        {selectedEvent && (
          <EventPreview
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
            onFilterAuthor={setAuthorFilter}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---- Main Component ----

export default function AdminExplorer() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { fetchAdminApi, nostr, user } = useAdminApi();
  const { isMaster, isLoading: authLoading } = useAdminAuth(user?.pubkey);

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['relay-explorer-stats'],
    queryFn: async () => {
      try {
        const response = await fetchAdminApi('/stats');
        if (response.ok) return response.json() as Promise<RelayStats>;
        if (response.status !== 404 && response.status !== 401) {
          throw new Error(await parseError(response));
        }
      } catch (error) {
        if (!nostr) throw error;
      }

      if (!nostr) throw new Error('Relay connection is unavailable');
      const relayEvents = await nostr.query([{ limit: 5000 }], {
        signal: AbortSignal.timeout(30000),
      });
      const events = relayEvents.map(({ id, pubkey, kind, created_at, content, tags }) => ({
        id, pubkey, kind, created_at, content, tags,
      }));
      return statsFromEvents(events);
    },
    enabled: !!user?.pubkey && isMaster,
  });

  const statsErrorShownRef = useRef(false);
  useEffect(() => {
    if (error && !statsErrorShownRef.current) {
      statsErrorShownRef.current = true;
      toast({ title: 'Error loading relay stats', description: String(error), variant: 'destructive' });
    }
    if (!error) {
      statsErrorShownRef.current = false;
    }
  }, [error]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['relay-explorer-stats'] });
  };

  const [authorFilter, setAuthorFilter] = useState<string>('');

  if (authLoading) {
    return <div className="flex items-center justify-center py-12"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!isMaster) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Relay Explorer is available only to the relay operator.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Relay Explorer</h2>
          <p className="text-sm text-muted-foreground">
            Browse events stored on this relay. View stats by category and pubkey, and filter events.
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh Stats
          </Button>
        </div>
      </div>

      <StatsOverview stats={stats} isLoading={isLoading} />

      <EventBrowser stats={stats} authorFilter={authorFilter} setAuthorFilter={setAuthorFilter} />

      {stats && <PubkeyBreakdown stats={stats} />}
    </div>
  );
}
