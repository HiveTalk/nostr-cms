import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { isBlockedRelay } from '@/lib/blockedRelays';

/**
 * Well-known, high-availability relays used as fallback when looking up an
 * author's NIP-65 relay list (kind 10002) or fetching events whose relay
 * hints are missing or non-functional (e.g. search-only relays like nos.today
 * that reject standard REQ queries).
 *
 * Used by `NostrEventEmbed` and `EventPickerDialog` to broaden relay
 * coverage so events can be discovered even when the naddr/nevent relay hint
 * is useless.
 */
export const FALLBACK_DISCOVERY_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

/**
 * Query the default relay pool and fan out to additional NIP-65 relays,
 * merging and deduplicating results by event ID.
 *
 * Used by social components (Feed, Notes, Zaps, Comments, DMs, Profiles)
 * that need to read from multiple relays beyond the default CMS relay.
 *
 * CMS content components should NOT use this — they read from the default
 * relay only via the standard nostr.query() pool.
 */
export async function queryWithNip65Fanout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nostr: any,
  filters: NostrFilter[],
  nip65RelayUrls: string[],
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const { events } = await queryWithNip65FanoutDetailed(nostr, filters, nip65RelayUrls, signal);
  return events;
}

/**
 * Per-source result of a fanout query. Index 0 is always the default relay
 * (nostr.query through the pool); the rest are NIP-65 relays in the order
 * they were passed in.
 */
export interface FanoutSource {
  url: string;
  status: 'fulfilled' | 'rejected';
  events: NostrEvent[];
}

export interface DetailedFanoutResult {
  events: NostrEvent[];
  sources: FanoutSource[];
}

/**
 * Same fanout as queryWithNip65Fanout, but reports which sources fulfilled
 * or rejected (e.g. aborted by timeout) and which events came from each.
 *
 * Callers that paginate need this to tell "the primary relay confirmed it
 * has no more data" apart from "some relay timed out and told us nothing".
 */
export async function queryWithNip65FanoutDetailed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nostr: any,
  filters: NostrFilter[],
  nip65RelayUrls: string[],
  signal: AbortSignal,
): Promise<DetailedFanoutResult> {
  // Start all queries in parallel. The default relay (nostr.query) is
  // the primary source — external NIP-65 relays supplement with additional
  // data. We wait for all to settle, but the signal timeout ensures slow
  // relays don't block the response for too long.
  const urls = ['default', ...nip65RelayUrls];
  const results = await Promise.allSettled([
    nostr.query(filters, { signal }),
    ...nip65RelayUrls.map((url: string) => {
      try {
        const relay = nostr.relay(url);
        return relay.query(filters, { signal });
      } catch {
        return Promise.resolve([] as NostrEvent[]);
      }
    }),
  ]);

  const sources: FanoutSource[] = results.map((r, i) => ({
    url: urls[i],
    status: r.status,
    events: r.status === 'fulfilled' ? r.value : [],
  }));

  // Deduplicate by event ID
  const events = Array.from(
    new Map(sources.flatMap((s) => s.events).map((e) => [e.id, e])).values(),
  );

  return { events, sources };
}

/**
 * Get the list of NIP-65 read relay URLs from relay metadata config.
 * Filters to only relays marked for reading, excluding blocked relays.
 */
export function getNip65ReadRelays(
  relayMetadata?: { relays: Array<{ url: string; read: boolean; write: boolean }> },
): string[] {
  return relayMetadata?.relays?.filter((r) => r.read).map((r) => r.url).filter(url => !isBlockedRelay(url)) || [];
}
