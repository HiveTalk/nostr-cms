import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrJsonUsers } from '@/hooks/useNostrJsonUsers';
import { getDefaultRelayUrl } from '@/lib/relay';
import type { NostrEvent, NostrFilter, NStore } from '@nostrify/nostrify';
import type {
  AnalyticsData,
  ParsedZap,
  ZapReceipt,
  CustomDateRange,
  TimeRange,
} from '@/types/zaplytics';
import {
  isValidZapReceipt,
  parseZapReceipt,
  getDateRange,
  groupZapsByPeriod,
  groupZapsByContent,
  groupZapsByKind,
  getTopZappers,
  groupZapsByHour,
  groupZapsByDayOfWeek,
  analyzeZapperLoyalty,
} from '@/lib/zaplytics/utils';

export interface MemberStats {
  pubkey: string;
  name: string;
  totalEarnings: number;
  totalZaps: number;
  uniqueZappers: number;
  topContentSats: number;
  topContentPreview: string;
  earningsByPeriod?: ReturnType<typeof groupZapsByPeriod>;
  topZappers?: ReturnType<typeof getTopZappers>;
}

export interface CommunityZapStats {
  aggregate: AnalyticsData;
  members: MemberStats[];
  /** Unix seconds — AdminZaplytics compares it against Date.now() / 1000. */
  lastUpdated: number;
  /** True when pagination hit a bound and totals are a lower bound. */
  partial?: boolean;
  /**
   * True when a boundary timestamp may hold more receipts than the relay's
   * page size and probes couldn't disprove it — possible incompleteness,
   * distinct from confirmed truncation.
   */
  suspectedPartial?: boolean;
  /** True when content/profile enrichment lookups failed or timed out. */
  enrichmentPartial?: boolean;
}

export type CommunityTimeRange = '24h' | '7d' | '30d' | 'all';

const RECEIPT_LIMIT = 5000;
const MAX_PAGES = 20; // 100k receipts safety cap
const CHUNK = 150;

/** '30d' isn't a single-pubkey TimeRange — express it as a custom window. */
function toRangeParams(timeRange: CommunityTimeRange): { tr: TimeRange; custom?: CustomDateRange } {
  if (timeRange === '30d') {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { tr: 'custom', custom: { from, to } };
  }
  return { tr: timeRange };
}

async function queryChunked(
  nostr: NStore,
  ids: string[],
  signal: AbortSignal,
): Promise<{ events: NostrEvent[]; complete: boolean }> {
  const out: NostrEvent[] = [];
  let complete = true;
  for (let i = 0; i < ids.length; i += CHUNK) {
    try {
      out.push(...(await nostr.query([{ ids: ids.slice(i, i + CHUNK) }], { signal })));
    } catch {
      // chunk failed — continue with what resolved
      complete = false;
    }
  }
  return { events: out, complete };
}

export function useCommunityZapStats(timeRange: CommunityTimeRange = 'all', enabled = true) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { data: nostrJsonUsers } = useNostrJsonUsers();

  const members = (nostrJsonUsers?.users || [])
    .filter((u) => u.pubkey)
    .map((u) => ({ name: u.name, pubkey: u.pubkey.toLowerCase().trim() }));
  const memberKey = members.map((m) => m.pubkey).sort().join(',');
  // reqRouter sends reads to getDefaultRelayUrl(); the key should encode that
  // dependency so these stats can never be mistaken for another relay's.
  const relayUrl = getDefaultRelayUrl();

  const { data: rawData, isLoading, error } = useQuery({
    queryKey: ['community-zap-stats', memberKey, timeRange, relayUrl],
    queryFn: async (): Promise<CommunityZapStats> => {
      const memberSet = new Set(members.map((m) => m.pubkey));
      if (memberSet.size === 0) {
        return { aggregate: emptyAnalytics(), members: [], lastUpdated: Math.floor(Date.now() / 1000) };
      }

      const { tr, custom } = toRangeParams(timeRange);
      const { since, until } = getDateRange(tr, custom);
      const signal = AbortSignal.timeout(60_000);

      // Page backwards through all kind-9735 receipts addressed to any member
      // (#p OR-match). `until` is inclusive, so every seen ID is tracked and a
      // page with zero unseen events terminates the loop — this also preserves
      // receipts that share a boundary timestamp.
      const seenIds = new Set<string>();
      const receipts: ZapReceipt[] = [];
      let cursor: number | undefined = until;
      let partial = false;
      // Irreducible same-second ambiguity — the boundary may hide events
      // that no filter can reach, but truncation isn't proven either.
      let suspectedPartial = false;
      // Largest page the relay has actually returned — its effective page cap,
      // which may be lower than the requested limit on some backends.
      let pageCapacity = 0;

      const ingest = (evt: NostrEvent): boolean => {
        if (seenIds.has(evt.id)) return false;
        seenIds.add(evt.id);
        if (isValidZapReceipt(evt)) receipts.push(evt as ZapReceipt);
        return true;
      };

      for (let page = 0; page < MAX_PAGES; page++) {
        const filter: NostrFilter = {
          kinds: [9735],
          '#p': [...memberSet],
          limit: RECEIPT_LIMIT,
          ...(since ? { since } : {}),
          ...(cursor ? { until: cursor } : {}),
        };

        let batch: NostrEvent[];
        try {
          batch = await nostr.query([filter], { signal });
        } catch (e) {
          // Timed out mid-pagination — report what we have as partial rather
          // than discarding the accumulated history.
          if (signal.aborted && receipts.length > 0) {
            partial = true;
            break;
          }
          throw e;
        }

        let newOnPage = 0;
        let oldest = Infinity;
        for (const evt of batch) {
          if (evt.created_at < oldest) oldest = evt.created_at;
          if (ingest(evt)) newOnPage++;
        }

        if (newOnPage === 0) {
          // A terminating page as large as the biggest page seen is
          // ambiguous: the boundary timestamp may hold more events than one
          // page can carry, and filters have no intra-timestamp cursor.
          // Re-query the timestamp with a limit one larger than the observed
          // page size. A short response fully enumerates the boundary; a
          // full one is the relay-cap ambiguity; a response beyond the page
          // size proves the earlier page WAS truncated (by the requested
          // limit, not the relay) — in both cases per-member #p probes can
          // still drain the crowded second. A member slice that fills the
          // probe is the irreducible case: flagged as possibly incomplete.
          if (batch.length > 0 && batch.length >= pageCapacity && cursor !== undefined) {
            let canResume = false;
            try {
              const tProbe = await nostr.query(
                [{
                  kinds: [9735],
                  '#p': [...memberSet],
                  limit: pageCapacity + 1,
                  since: cursor,
                  until: cursor,
                }],
                { signal },
              );
              for (const evt of tProbe) ingest(evt);
              canResume = true;
              if (tProbe.length >= pageCapacity) {
                // tProbe hit P or P+1: the boundary may hold unseen events.
                // A member slice as large as the tProbe itself is still
                // ambiguous — its own page could be truncated under the same
                // cap. Anything smaller enumerates that member's slice.
                for (const memberPk of memberSet) {
                  const probe = await nostr.query(
                    [{
                      kinds: [9735],
                      '#p': [memberPk],
                      limit: pageCapacity + 1,
                      since: cursor,
                      until: cursor,
                    }],
                    { signal },
                  );
                  for (const evt of probe) ingest(evt);
                  if (probe.length >= tProbe.length) suspectedPartial = true;
                }
              }
            } catch {
              // Couldn't disambiguate — abort means pagination definitely
              // stopped early; anything else leaves the doubt unresolved.
              if (signal.aborted) partial = true;
              else suspectedPartial = true;
            }

            if (canResume && page < MAX_PAGES - 1) {
              cursor = cursor - 1;
              continue;
            }
            // Boundary resolved but the page budget is spent — any history
            // below it is confirmed unreachable within this query.
            if (canResume) partial = true;
          }
          break;
        }
        pageCapacity = Math.max(pageCapacity, batch.length);
        if (since > 0 && oldest <= since) {
          // The range floor may hold more receipts than the page carried —
          // probe the boundary second with a limit beyond what we have seen
          // there; unseen receipts mean the range is truncated, not complete.
          try {
            const seenAtFloor = [...receipts.values()].filter(
              (e) => e.created_at === since,
            ).length;
            const floorProbe = await nostr.query(
              [{
                kinds: [9735],
                '#p': [...memberSet],
                limit: seenAtFloor + 1,
                since,
                until: since,
              }],
              { signal },
            );
            // A probe at the observed relay cap is ambiguous even if nothing
            // new appears — the second may exceed what the cap carries.
            if (floorProbe.length > seenAtFloor || floorProbe.length >= pageCapacity) {
              suspectedPartial = true;
            }
            for (const evt of floorProbe) ingest(evt);
          } catch {
            suspectedPartial = true;
          }
          break;
        }
        cursor = oldest;
        if (page === MAX_PAGES - 1) partial = true;
      }

      const parsedZaps = receipts
        .map(parseZapReceipt)
        .filter((z): z is ParsedZap => z !== null);

      // Enrichment gets its own time budget: pagination's signal may already
      // be aborted after a timeout, and reusing it would silently starve the
      // content and profile lookups for receipts that were fetched fine.
      // A fresh 60s preserves the previous shared-budget worst case.
      const enrichSignal = AbortSignal.timeout(60_000);
      let enrichmentPartial = false;

      // Enrich zapped events (e-tags → real kind/content/author/created_at)
      const eIds = [...new Set(
        parsedZaps.map((z) => z.zappedEvent?.id).filter((id): id is string => !!id),
      )];
      const contentMap = new Map<string, NostrEvent>();
      const contentResult = await queryChunked(nostr, eIds, enrichSignal);
      if (!contentResult.complete) enrichmentPartial = true;
      for (const evt of contentResult.events) {
        contentMap.set(evt.id, evt);
      }

      // Enrich zapper profiles (kind 0) for name/picture — chunked so large
      // communities aren't silently capped; keep the newest profile per pubkey.
      const zapperPks = [...new Set(parsedZaps.map((z) => z.zapper.pubkey))];
      const profileMap = new Map<string, Record<string, unknown>>();
      const profileTs = new Map<string, number>();
      for (let i = 0; i < zapperPks.length; i += CHUNK) {
        const chunk = zapperPks.slice(i, i + CHUNK);
        const profileEvents = await nostr.query(
          [{ kinds: [0], authors: chunk, limit: chunk.length }],
          { signal: enrichSignal },
        ).catch(() => {
          enrichmentPartial = true;
          return [] as NostrEvent[];
        });
        for (const evt of profileEvents) {
          if (evt.created_at <= (profileTs.get(evt.pubkey) ?? -1)) continue;
          try {
            profileMap.set(evt.pubkey, JSON.parse(evt.content));
            profileTs.set(evt.pubkey, evt.created_at);
          } catch { /* skip */ }
        }
      }

      for (const zap of parsedZaps) {
        if (zap.zappedEvent && contentMap.has(zap.zappedEvent.id)) {
          const evt = contentMap.get(zap.zappedEvent.id)!;
          zap.zappedEvent = {
            ...zap.zappedEvent,
            kind: evt.kind,
            author: evt.pubkey,
            content: evt.content,
            created_at: evt.created_at,
          };
        }
        const profile = profileMap.get(zap.zapper.pubkey);
        if (profile) {
          zap.zapper = {
            ...zap.zapper,
            name: (profile.name as string) || (profile.display_name as string),
            nip05: profile.nip05 as string,
            picture: profile.picture as string,
          };
        }
      }

      // Per-member grouping by the receipt's `p` tag (recipient)
      const byMember = new Map<string, ParsedZap[]>();
      for (const zap of parsedZaps) {
        const recipient = zap.receipt.tags.find((t) => t[0] === 'p')?.[1]?.toLowerCase();
        if (!recipient || !memberSet.has(recipient)) continue;
        const arr = byMember.get(recipient) || [];
        arr.push(zap);
        byMember.set(recipient, arr);
      }

      // Iterate every member so recipients with no zaps still appear with
      // zeroed stats rather than vanishing from comparisons.
      const memberStats: MemberStats[] = members.map((member) => {
        const zaps = byMember.get(member.pubkey) || [];
        const top = groupZapsByContent(zaps)[0];
        return {
          pubkey: member.pubkey,
          name: member.name || '',
          totalEarnings: zaps.reduce((s, z) => s + z.amount, 0),
          totalZaps: zaps.length,
          uniqueZappers: new Set(zaps.map((z) => z.zapper.pubkey)).size,
          topContentSats: top?.totalSats || 0,
          topContentPreview: (top?.content || '').slice(0, 100),
          earningsByPeriod: groupZapsByPeriod(zaps, tr, custom),
          topZappers: getTopZappers(zaps).slice(0, 5),
        };
      }).sort((a, b) => b.totalEarnings - a.totalEarnings);

      const communityZaps = parsedZaps.filter((zap) => {
        const recipient = zap.receipt.tags.find((t) => t[0] === 'p')?.[1]?.toLowerCase();
        return !!recipient && memberSet.has(recipient);
      });

      const aggregate: AnalyticsData = {
        totalEarnings: communityZaps.reduce((s, z) => s + z.amount, 0),
        totalZaps: communityZaps.length,
        uniqueZappers: new Set(communityZaps.map((z) => z.zapper.pubkey)).size,
        period: 'community',
        earningsByPeriod: groupZapsByPeriod(communityZaps, tr, custom),
        topContent: groupZapsByContent(communityZaps).slice(0, 5),
        earningsByKind: groupZapsByKind(communityZaps),
        topZappers: getTopZappers(communityZaps).slice(0, 5),
        allZaps: [],
        temporalPatterns: {
          earningsByHour: groupZapsByHour(communityZaps),
          earningsByDayOfWeek: groupZapsByDayOfWeek(communityZaps),
        },
        zapperLoyalty: analyzeZapperLoyalty(communityZaps),
        contentPerformance: [],
        hashtagPerformance: [],
      };

      return {
        aggregate,
        members: memberStats,
        lastUpdated: Math.floor(Date.now() / 1000),
        partial,
        suspectedPartial,
        enrichmentPartial,
      };
    },
    enabled: enabled && !!user?.pubkey && memberKey.length > 0,
    staleTime: 60 * 1000,
    retry: 1,
  });

  // Member names come from nostr.json, not the relay — overlay the live names
  // onto cached stats so a rename updates labels without a refetch.
  const data = useMemo(() => {
    if (!rawData) return rawData;
    const names = new Map(
      (nostrJsonUsers?.users || [])
        .filter((u) => u.pubkey)
        .map((u) => [u.pubkey.toLowerCase().trim(), u.name]),
    );
    return {
      ...rawData,
      members: rawData.members.map((m) => ({ ...m, name: names.get(m.pubkey) ?? m.name })),
    };
  }, [rawData, nostrJsonUsers]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['community-zap-stats'] });
  }, [queryClient]);

  return { data, isLoading, error, refetch: refresh };
}

function emptyAnalytics(): AnalyticsData {
  return {
    totalEarnings: 0,
    totalZaps: 0,
    uniqueZappers: 0,
    period: 'community',
    earningsByPeriod: [],
    topContent: [],
    earningsByKind: [],
    topZappers: [],
    allZaps: [],
    temporalPatterns: { earningsByHour: [], earningsByDayOfWeek: [] },
    zapperLoyalty: {
      newZappers: 0,
      returningZappers: 0,
      regularSupporters: 0,
      averageLifetimeValue: 0,
      topLoyalZappers: [],
    },
    contentPerformance: [],
    hashtagPerformance: [],
  };
}
