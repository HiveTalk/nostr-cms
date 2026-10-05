import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, Database, HardDrive, Image as ImageIcon, Video } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { categorizeKinds, kindLabel } from '@/lib/kinds';
import { getDefaultRelayUrl } from '@/lib/relay';
import { useBlossomRelays } from '@/hooks/useBlossomRelays';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { fetchBlossomList } from '@/lib/blossom';

// ---- Types ----

interface MyStatsResponse {
  pubkey: string;
  total: number;
  /** true when the relay stopped returning events before the full history was retrieved */
  partial: boolean;
  byKind: Record<string, number>;
  lastActivity: number;
  blossom: {
    count: number;
    totalSize: number;
    images: number;
    videos: number;
    other: number;
  };
  /** true when the /list request failed — distinguishes "unavailable" from "empty" */
  blossomUnavailable: boolean;
  embedded: {
    images: number;
    videos: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)([?#].*)?$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)([?#].*)?$/i;
const URL_RE = /https?:\/\/[^\s"'<>()[\]]+/g;
const MEDIA_TAGS = new Set(['image', 'thumb', 'banner', 'picture']);

function tallyMediaUrl(url: string, mime: string | undefined, acc: { images: number; videos: number }) {
  const isVideo = mime ? mime.startsWith('video/') : VIDEO_EXT.test(url);
  const isImage = mime ? mime.startsWith('image/') : IMAGE_EXT.test(url);
  if (isVideo) acc.videos++;
  else if (isImage) acc.images++;
}

// Relays clamp per-query results (e.g. badger backends ignore limits above
// MaxLimit and fall back to ~250), so a short page never means "done" — only a
// page with zero unseen events does.
const PAGE_SIZE = 500;
const MAX_PAGES = 40; // 20k events safety cap

/**
 * Page one author filter backwards through history using `until` (inclusive,
 * so results are deduped by id) until a page yields nothing new.
 *
 * Each filter needs its own cursor: relays apply `limit` per filter, so a
 * shared cursor computed from a union of pages would skip unread events in
 * whichever filter's page ended at a later timestamp.
 */
async function paginateAuthorFilter(
  nostr: { query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]> },
  filter: NostrFilter,
  signal: AbortSignal,
): Promise<{ events: NostrEvent[]; partial: boolean }> {
  const events = new Map<string, NostrEvent>();
  let until: number | undefined;
  let partial = false;
  let relayCap = 0; // largest observed page = effective relay cap estimate

  for (let page = 0; page < MAX_PAGES; page++) {
    const f: NostrFilter = { ...filter };
    if (until !== undefined) f.until = until;

    let batch: NostrEvent[];
    try {
      batch = await nostr.query([f], { signal });
    } catch (e) {
      // Timed out mid-pagination — report what we have as partial rather
      // than discarding a large accumulated history.
      if (signal.aborted && events.size > 0) {
        partial = true;
        break;
      }
      throw e;
    }

    let newOnPage = 0;
    let oldest = Infinity;
    for (const evt of batch) {
      if (!events.has(evt.id)) {
        events.set(evt.id, evt);
        newOnPage++;
      }
      if (evt.created_at < oldest) oldest = evt.created_at;
    }

    relayCap = Math.max(relayCap, batch.length);
    if (newOnPage === 0) {
      if (batch.length === 0 || until === undefined) break;
      // The page repeated: the boundary second may exceed the relay's cap —
      // filters have no intra-timestamp cursor. Probe it for PROOF of
      // omission: unseen IDs or a response above the observed cap. Equality
      // is fundamentally ambiguous (can't distinguish a hard cap from an
      // exactly-full second) and is not evidence — it is not flagged.
      try {
        const probe = await nostr.query(
          [{ ...filter, since: until, until, limit: relayCap + 1 }],
          { signal },
        );
        if (probe.length > relayCap || probe.some((evt) => !events.has(evt.id))) {
          partial = true;
        }
      } catch {
        partial = true;
      }
      if (page === MAX_PAGES - 1) {
        // Budget spent — flag only when history actually remains unread.
        try {
          const remaining = await nostr.query(
            [{ ...filter, until: until - 1, limit: 1 }],
            { signal },
          );
          if (remaining.length > 0) partial = true;
        } catch {
          partial = true;
        }
        break;
      }
      // `until` is inclusive — step below the boundary second to keep reading
      // older events rather than stopping at the repeated page.
      until = until - 1;
      continue;
    }
    until = oldest;
    if (page === MAX_PAGES - 1) partial = true;
  }

  return { events: [...events.values()], partial };
}

export default function MyActivityCard() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const blossomRelays = useBlossomRelays();

  // Blossom server for the /list lookup: the configured blossom server,
  // falling back to the same relay the events come from (ws → http origin).
  // Deliberately not getApiBaseUrl() — VITE_SWARM_API_URL can point at a
  // different host than the relay serving the events.
  let blossomBase = blossomRelays[0] || '';
  if (!blossomBase) {
    try {
      blossomBase = new URL(
        getDefaultRelayUrl().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'),
      ).origin;
    } catch {
      // leave empty — the fetch reports unavailable below
    }
  }

  // Personal stats computed client-side — the relay's /api/*/my-stats
  // endpoint may not exist upstream, and the data is public anyway:
  //   - events come from a WebSocket `authors` query against the relay
  //   - blossom stats come from the public BUD-02 /list/<pubkey> endpoint
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['my-stats', user?.pubkey, blossomBase],
    queryFn: async (): Promise<MyStatsResponse> => {
      const pubkey = user!.pubkey.toLowerCase().trim();
      const signal = AbortSignal.timeout(60_000);

      // The kind-24242 kind+author filter covers blossom blob index events,
      // which some deployments don't expose through the pubkey-only index.
      // Its failure or absence is non-fatal: blobs still show via /list, and
      // the totals are marked partial rather than presented as complete.
      const [main, blobIndex] = await Promise.all([
        paginateAuthorFilter(nostr, { authors: [pubkey], limit: PAGE_SIZE }, signal),
        paginateAuthorFilter(nostr, { authors: [pubkey], kinds: [24242], limit: PAGE_SIZE }, signal)
          .catch(() => ({ events: [] as NostrEvent[], partial: true })),
      ]);
      const eventsById = new Map<string, NostrEvent>();
      for (const evt of [...main.events, ...blobIndex.events]) eventsById.set(evt.id, evt);
      const events = [...eventsById.values()];
      const partial = main.partial || blobIndex.partial;

      const byKind: Record<string, number> = {};
      const embedded = { images: 0, videos: 0 };
      let lastActivity = 0;

      for (const evt of events) {
        byKind[evt.kind] = (byKind[evt.kind] || 0) + 1;
        if (evt.created_at > lastActivity) lastActivity = evt.created_at;

        for (const tag of evt.tags) {
          if (tag[0] === 'imeta') {
            let url = '';
            let mime: string | undefined;
            for (const part of tag.slice(1)) {
              if (part.startsWith('url ')) url = part.slice(4);
              else if (part.startsWith('m ')) mime = part.slice(2);
            }
            if (url) tallyMediaUrl(url, mime, embedded);
          } else if (tag.length >= 2 && MEDIA_TAGS.has(tag[0])) {
            const url = tag[1].toLowerCase();
            if (VIDEO_EXT.test(url) || IMAGE_EXT.test(url)) {
              tallyMediaUrl(url, undefined, embedded);
            }
          }
        }

        if (evt.kind === 0) {
          try {
            const profile = JSON.parse(evt.content) as Record<string, unknown>;
            for (const field of ['picture', 'banner', 'image']) {
              const val = profile[field];
              if (typeof val === 'string') {
                const url = val.toLowerCase();
                if (VIDEO_EXT.test(url) || IMAGE_EXT.test(url)) {
                  tallyMediaUrl(url, undefined, embedded);
                }
              }
            }
          } catch {
            // not JSON — skip
          }
        } else if (evt.kind !== 24242 && evt.content) {
          for (const raw of evt.content.toLowerCase().match(URL_RE) ?? []) {
            const url = raw.replace(/[.,;:!?)\]]+$/, '');
            if (VIDEO_EXT.test(url) || IMAGE_EXT.test(url)) {
              tallyMediaUrl(url, undefined, embedded);
            }
          }
        }
      }

      // Blossom blobs owned by this pubkey — anonymous /list first, with a
      // signed kind-24242 retry when the server requires BUD authorization.
      const blossom = { count: 0, totalSize: 0, images: 0, videos: 0, other: 0 };
      const blobs = blossomBase
        ? await fetchBlossomList(blossomBase, pubkey, user!.signer)
        : null;
      const blossomUnavailable = blobs === null;
      if (blobs) {
        for (const blob of blobs) {
          blossom.count++;
          blossom.totalSize += blob.size || 0;
          if (blob.type?.startsWith('image/')) blossom.images++;
          else if (blob.type?.startsWith('video/')) blossom.videos++;
          else blossom.other++;
        }
      }

      return {
        pubkey,
        total: events.length,
        partial,
        byKind,
        lastActivity,
        blossom,
        blossomUnavailable,
        embedded,
      };
    },
    enabled: !!user?.pubkey,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['my-stats'] });
  };

  // Convert byKind (string keys from JSON) to the format categorizeKinds expects
  const byKind: Record<string, number> = {};
  if (stats?.byKind) {
    for (const [k, v] of Object.entries(stats.byKind)) {
      byKind[k] = v;
    }
  }
  const categories = stats ? categorizeKinds(byKind) : [];
  const hasMedia = !!(stats && (stats.blossom.count > 0 || stats.embedded.images > 0 || stats.embedded.videos > 0));

  // Media section is rendered independently of the event count — an account
  // can own Blossom blobs without having any queryable events.
  const mediaSection = stats && (hasMedia || stats.blossomUnavailable) ? (
    <div className="space-y-2 pt-2 border-t">
      {/* Blossom media (stored on this relay) */}
      {stats.blossomUnavailable ? (
        <div className="flex items-center gap-2">
          <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Blossom media list unavailable</span>
        </div>
      ) : stats.blossom.count > 0 ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Blossom media</span>
            <span className="text-sm font-mono">{stats.blossom.count}</span>
            <span className="text-xs text-muted-foreground">
              ({formatBytes(stats.blossom.totalSize)})
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pl-5">
            {stats.blossom.images > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                {stats.blossom.images} image{stats.blossom.images !== 1 ? 's' : ''}
              </span>
            )}
            {stats.blossom.videos > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Video className="h-3 w-3" />
                {stats.blossom.videos} video{stats.blossom.videos !== 1 ? 's' : ''}
              </span>
            )}
            {stats.blossom.other > 0 && (
              <span className="text-xs text-muted-foreground">
                {stats.blossom.other} other
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* Embedded media (imeta tags in posts, may be hosted elsewhere) */}
      {stats.embedded.images > 0 || stats.embedded.videos > 0 ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Media in posts</span>
          </div>
          <div className="flex flex-wrap gap-2 pl-5">
            {stats.embedded.images > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                {stats.embedded.images} image{stats.embedded.images !== 1 ? 's' : ''}
              </span>
            )}
            {stats.embedded.videos > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Video className="h-3 w-3" />
                {stats.embedded.videos} video{stats.embedded.videos !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">My Activity</CardTitle>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Failed to load activity.
            </p>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Retry
            </Button>
          </div>
        ) : !stats || stats.total === 0 ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-2xl font-bold">0</p>
              <p className="text-xs text-muted-foreground">
                No events from you on this relay yet.
              </p>
              <p className="text-xs text-muted-foreground">
                Use{' '}
                <Link to="/admin/sync-content" className="underline hover:text-primary">
                  Sync Content
                </Link>{' '}
                to back up your activity from other relays.
              </p>
            </div>
            {mediaSection}
          </div>
        ) : (
          <>
            {/* Total + last activity */}
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">
                {stats.total.toLocaleString()}{stats.partial && '+'}
              </span>
              <span className="text-xs text-muted-foreground">
                events on this relay
              </span>
            </div>
            {stats.lastActivity > 0 && (
              <p className="text-xs text-muted-foreground">
                Last activity:{' '}
                {new Date(stats.lastActivity * 1000).toLocaleDateString()}
              </p>
            )}
            {stats.partial && (
              <p className="text-xs text-muted-foreground">
                The relay stopped returning older events — totals are a lower bound.
              </p>
            )}

            {/* Categorized breakdown — hover for per-kind details */}
            <div className="space-y-1.5 pt-1">
              {categories.map((cat) => (
                <div key={cat.label} className="flex items-center gap-2">
                  {cat.kinds.length > 1 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">
                          <Badge variant="secondary" className="text-xs font-medium">
                            {cat.label}
                          </Badge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <div className="space-y-0.5">
                          {cat.kinds.map(({ kind, count }) => (
                            <div key={kind} className="flex justify-between gap-3 text-xs">
                              <span>{kindLabel(kind)}</span>
                              <span className="font-mono text-muted-foreground">{count}</span>
                            </div>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Badge variant="secondary" className="text-xs font-medium">
                      {cat.label}
                    </Badge>
                  )}
                  <span className="text-sm font-mono">{cat.count}</span>
                </div>
              ))}
            </div>

            {/* Media section */}
            {mediaSection}

            <p className="text-xs text-muted-foreground pt-1">
              Back up your events via{' '}
              <Link to="/admin/sync-content" className="underline hover:text-primary">
                Sync Content
              </Link>
              .
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
