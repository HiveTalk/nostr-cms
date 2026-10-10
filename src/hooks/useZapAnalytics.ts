import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import type { NostrEvent } from '@nostrify/nostrify';
import { queryWithNip65FanoutDetailed, getNip65ReadRelays } from '@/lib/queryRelays';
import type {
  ZapReceipt,
  ParsedZap,
  AnalyticsData,
  TimeRange,
  CustomDateRange
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
  analyzeContentPerformance,
  analyzeHashtagPerformance
} from '@/lib/zaplytics/utils';

/**
 * Configuration for zap fetching - optimized for progressive loading
 */
const ZAP_FETCH_CONFIG = {
  INITIAL_BATCH_SIZE: 2000, // Large enough to fetch all receipts in one batch from local relay
  MIN_BATCH_SIZE: 250, // Minimum batch size when relay limits are hit
  MAX_BATCH_SIZE: 2000, // Maximum batch size to prevent timeouts
  TIMEOUT_MS: 3000, // Short timeout for 24h/7d — local relay is fast
  ALL_TIME_TIMEOUT_MS: 15000, // 15s for all-time — mobile networks need more time for 1263+ events
  STALE_TIME: 60000, // 1 minute cache
  REFETCH_INTERVAL: 300000, // Refetch every 5 minutes
  BATCH_DELAY_MS: 200, // Delay between automatic batches
  AUTO_LOAD_DELAY_MS: 300, // Delay before starting automatic loading
  MAX_CONSECUTIVE_FAILURES: 3, // Stop auto-loading after 3 consecutive failures
} as const;

/**
 * Global cache for zap receipts per user
 */
const userZapCache = new Map<string, ZapReceipt[]>();

/**
 * Global cache for user profiles
 */
const profileCache = new Map<string, Record<string, unknown>>();

/**
 * Clear all module-level zap caches. Call this when the relay changes
 * to prevent stale data from persisting across relay switches.
 */
export function clearZapCaches(): void {
  userZapCache.clear();
  profileCache.clear();
}

/**
 * Progressive zap loading state
 */
interface ZapLoadingState {
  receipts: ZapReceipt[];
  isLoading: boolean;
  isComplete: boolean;
  currentBatch: number;
  totalFetched: number;
  relayLimit: number | null; // Detected relay limit
  error: string | null;
  autoLoadEnabled: boolean; // Whether automatic loading is enabled
  consecutiveFailures: number; // Track failures to stop auto-loading
  consecutiveZeroResults: number; // Track consecutive zero-result batches to stop infinite loops
  allReceiptsCache: ZapReceipt[]; // All receipts ever loaded for this user
}

/**
 * Custom hook for progressive zap receipt loading with smart caching
 */
function useProgressiveZapReceipts(timeRange: TimeRange = '7d', customRange?: CustomDateRange, targetPubkey?: string) {
  const { nostr } = useNostr();
  const { user: currentUser } = useCurrentUser();
  const { config } = useAppContext();
  const nip65ReadRelays = getNip65ReadRelays(config.relayMetadata);
  const pubkey = targetPubkey || currentUser?.pubkey;

  const [state, setState] = useState<ZapLoadingState>({
    receipts: [],
    isLoading: false,
    isComplete: false,
    currentBatch: 0,
    totalFetched: 0,
    relayLimit: null,
    error: null,
    autoLoadEnabled: true,
    consecutiveFailures: 0,
    consecutiveZeroResults: 0,
    allReceiptsCache: [],
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const isLoadingRef = useRef(false);
  // Owner-tagged auto-load timeout. Effect cleanups may only clear timeouts
  // they scheduled themselves — a cleanup that clears a timeout scheduled by
  // loadMoreZaps' continuation would silently stall pagination.
  const autoLoadTimeoutRef = useRef<{ owner: string; handle: NodeJS.Timeout } | null>(null);
  // Oldest event timestamp ever returned by the primary (default) relay.
  // Drives the pagination cursor so supplemental relays can't move it.
  const primaryOldestRef = useRef<number | null>(null);
  // Consecutive zero-new pages where the primary relay actually answered.
  // Only these count toward 'all'-time completion.
  const answeredZeroStreakRef = useRef(0);
  const loadMoreZapsRef = useRef<((isAutomatic?: boolean) => Promise<void>) | null>(null);
  const stateRef = useRef(state);

  // Keep state ref updated
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Schedule an auto-load call under an owner tag. Replaces any pending
  // timeout (all owners schedule the same function, so last-write wins).
  const scheduleAutoLoad = useCallback((owner: string, delay: number) => {
    if (autoLoadTimeoutRef.current) {
      clearTimeout(autoLoadTimeoutRef.current.handle);
    }
    autoLoadTimeoutRef.current = {
      owner,
      handle: setTimeout(() => {
        autoLoadTimeoutRef.current = null;
        loadMoreZapsRef.current?.(true).catch((error) => {
          console.error('Auto-load failed:', error);
        });
      }, delay),
    };
  }, []);

  // Clear a pending auto-load timeout only if the given owner scheduled it.
  const clearOwnedAutoLoad = useCallback((owner: string) => {
    if (autoLoadTimeoutRef.current?.owner === owner) {
      clearTimeout(autoLoadTimeoutRef.current.handle);
      autoLoadTimeoutRef.current = null;
    }
  }, []);

  // Initialize from cache and filter by time range
  useEffect(() => {
    if (!pubkey) return;

    const userCache = userZapCache.get(pubkey) || [];
    const { since, until } = getDateRange(timeRange, customRange);

    // Filter cached receipts by time range - check for custom ranges specifically
    const isCustomRange = timeRange === 'custom';
    const filteredReceipts = userCache.filter(receipt => {
      if (isCustomRange && until) {
        // For custom ranges, filter both ends
        return receipt.created_at >= since && receipt.created_at <= until;
      } else {
        // For preset ranges, filter only since
        return receipt.created_at >= since;
      }
    });

    // Check if we have complete coverage for this time range
    const oldestCachedTimestamp = userCache.length > 0
      ? Math.min(...userCache.map(r => r.created_at))
      : 0;

    // For preset ranges, we need to be more strict about completeness
    // Only consider it complete if we actually have data going back to the time range boundary
    let hasCompleteCoverage: boolean;

    if (isCustomRange && until) {
      const cacheCoversCustomRange = userCache.length > 0 && oldestCachedTimestamp <= since;
      hasCompleteCoverage = cacheCoversCustomRange;
    } else {
      hasCompleteCoverage = userCache.length > 0 && oldestCachedTimestamp <= since;
    }

    setState(prev => ({
      ...prev,
      receipts: filteredReceipts,
      allReceiptsCache: userCache,
      totalFetched: filteredReceipts.length,
      isComplete: hasCompleteCoverage,
      // CRITICAL FIX: Don't reset currentBatch when switching time ranges
      // This preserves the pagination state and prevents false completion detection
      error: null,
    }));
  }, [pubkey, timeRange, customRange]);

  // Reset state when user changes (but not time range)
  useEffect(() => {
    abortControllerRef.current?.abort();
    if (autoLoadTimeoutRef.current) {
      clearTimeout(autoLoadTimeoutRef.current.handle);
      autoLoadTimeoutRef.current = null;
    }
    isLoadingRef.current = false;
    primaryOldestRef.current = null;
    answeredZeroStreakRef.current = 0;

    // Only reset when user changes, not time range
    setState({
      receipts: [],
      isLoading: false,
      isComplete: false,
      currentBatch: 0,
      totalFetched: 0,
      relayLimit: null,
      error: null,
      autoLoadEnabled: true,
      consecutiveFailures: 0,
      consecutiveZeroResults: 0,
      allReceiptsCache: [],
    });
  }, [pubkey]);

  // Progressive loading function
  const loadMoreZaps = useCallback(async (isAutomatic = false) => {
    // Get the current state fresh to avoid closure issues
    const currentState = stateRef.current;

    // answeredZeroStreakRef is checked alongside isComplete because state
    // updates may not have flushed yet when a scheduled batch fires.
    if (!pubkey || isLoadingRef.current || currentState.isComplete ||
      (timeRange === 'all' && answeredZeroStreakRef.current >= 3)) {
      return;
    }

    // Stop automatic loading if disabled, too many failures, or too many consecutive zero results
    const maxConsecutiveZeroResults = 3; // Stop after 3 consecutive zero-result batches
    if (isAutomatic && (
      !currentState.autoLoadEnabled ||
      currentState.consecutiveFailures >= ZAP_FETCH_CONFIG.MAX_CONSECUTIVE_FAILURES ||
      currentState.consecutiveZeroResults >= maxConsecutiveZeroResults
    )) {
      return;
    }

    isLoadingRef.current = true;
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    // Cancel any existing request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    try {
      const { since, until } = getDateRange(timeRange, customRange);

      // Calculate the correct until timestamp for pagination.
      // The cursor is driven by the primary (default) relay's oldest event.
      // Supplemental relays may contribute events older than the primary's
      // frontier — letting those move the cursor would jump the window back
      // past unfetched primary events and leave a permanent gap.
      // Falls back to the merged-cache minimum when the primary has never
      // returned anything (e.g. viewing a non-member's zaps).
      let currentUntil = until;
      const cursorBase = primaryOldestRef.current ?? (currentState.allReceiptsCache.length > 0
        ? Math.min(...currentState.allReceiptsCache.map(r => r.created_at))
        : null);
      if (cursorBase !== null) {
        const paginationUntil = cursorBase - 1;

        // For custom ranges, respect the custom range's until boundary
        if (timeRange === 'custom' && until) {
          currentUntil = Math.min(paginationUntil, until);
        } else {
          currentUntil = paginationUntil;
        }
      }

      // Determine batch size based on detected relay limit
      let batchSize = currentState.relayLimit || ZAP_FETCH_CONFIG.INITIAL_BATCH_SIZE;

      // Cap the batch size to prevent timeouts
      batchSize = Math.min(batchSize, ZAP_FETCH_CONFIG.MAX_BATCH_SIZE);

      // For automatic loading, if we detected a relay limit, use it.
      // If no limit was detected (relay returned full batches), keep using
      // the initial batch size — don't artificially reduce to MIN_BATCH_SIZE.
      if (isAutomatic && currentState.currentBatch > 0 && currentState.relayLimit) {
        batchSize = Math.min(batchSize, currentState.relayLimit);
      }

      const filter: {
        kinds: number[];
        '#p': string[];
        limit: number;
        since?: number;
        until?: number;
      } = {
        kinds: [9735],
        '#p': [pubkey],
        limit: batchSize,
      };

      if (currentUntil) {
        filter.until = currentUntil;
      }
      if (since > 0) {
        filter.since = since;
      }

      const batchSignal = AbortSignal.any([
        abortControllerRef.current.signal,
        AbortSignal.timeout(timeRange === 'all' ? ZAP_FETCH_CONFIG.ALL_TIME_TIMEOUT_MS : ZAP_FETCH_CONFIG.TIMEOUT_MS)
      ]);

      // Fan out to NIP-65 relays since zap receipts may live on multiple relays
      const { events, sources } = await queryWithNip65FanoutDetailed(nostr, [filter], nip65ReadRelays, batchSignal);
      const primaryResult = sources[0];
      const primaryFulfilled = primaryResult?.status === 'fulfilled';

      // Drop events that violate the until cursor — a relay that ignores
      // 'until' returns its newest events, which are all already cached
      // duplicates and would falsely signal end-of-data.
      const inWindow = currentUntil
        ? events.filter(e => e.created_at <= currentUntil)
        : events;

      // Filter and validate zap receipts
      const validReceipts = inWindow.filter((event): event is ZapReceipt =>
        isValidZapReceipt(event as NostrEvent)
      ).sort((a, b) => b.created_at - a.created_at);

      // Deduplicate against the current cache by event ID.
      // Without this, receipts returned from multiple relays in overlapping
      // batches get double-counted, inflating totals. Also prevents infinite
      // pagination loops where the relay keeps returning the same cached receipts.
      const currentCacheIds = new Set(currentState.allReceiptsCache.map(r => r.id));
      const newUnique = validReceipts.filter(r => !currentCacheIds.has(r.id));

      // Track the primary relay's oldest event — this drives the next
      // batch's until cursor. Only events within the window count, so an
      // until-violating primary can't corrupt its own cursor.
      if (primaryFulfilled && primaryResult.events.length > 0) {
        const primaryInWindow = currentUntil
          ? primaryResult.events.filter(e => e.created_at <= currentUntil)
          : primaryResult.events;
        if (primaryInWindow.length > 0) {
          const oldest = Math.min(...primaryInWindow.map(e => e.created_at));
          primaryOldestRef.current = primaryOldestRef.current === null
            ? oldest
            : Math.min(primaryOldestRef.current, oldest);
        }
      }

      // 'all'-time completion streak: only zero-new pages where the primary
      // relay actually answered count. Pages where the primary timed out are
      // inconclusive — auto-loading continues until the no-progress gate
      // (consecutiveZeroResults) stops it, leaving a manual retry available.
      if (newUnique.length > 0) {
        answeredZeroStreakRef.current = 0;
      } else if (timeRange === 'all' && primaryFulfilled) {
        answeredZeroStreakRef.current += 1;
      }

      // Update state synchronously
      setState(prev => {
        // Re-check against prev in case state changed between reads
        const prevSeen = new Set(prev.allReceiptsCache.map(r => r.id));
        const prevNewUnique = validReceipts.filter(r => !prevSeen.has(r.id));
        const allReceipts = [...prev.allReceiptsCache, ...prevNewUnique].sort((a, b) => b.created_at - a.created_at);

        // Update the global cache for this user
        if (pubkey) {
          userZapCache.set(pubkey, allReceipts);
        }

        // Filter for current time range
        const { since, until } = getDateRange(timeRange, customRange);
        const isCustomRange = timeRange === 'custom';
        const filteredReceipts = allReceipts.filter(receipt => {
          if (isCustomRange && until) {
            // For custom ranges, filter both ends
            return receipt.created_at >= since && receipt.created_at <= until;
          } else {
            // For preset ranges, filter only since
            return receipt.created_at >= since;
          }
        });

        // Detect relay limit based on batch results.
        // Use prevNewUnique (deduplicated against cache) so we don't mistake
        // already-cached results for a relay limit.
        // Use a reasonable minimum (100) so we don't end up with tiny batches
        // of 5 events that take forever to paginate through 1263 receipts.
        // The isComplete check below uses the actual count, not the inflated
        // limit, so this doesn't cause premature completion.
        const detectedLimit = prevNewUnique.length < batchSize && prevNewUnique.length > 0
          ? Math.max(prevNewUnique.length, 100)
          : prev.relayLimit;

        // Determine if loading is complete.
        // Use prevNewUnique for checks — if all results were already in the
        // cache, there's no new data to paginate through.
        const expectedBatchSize = detectedLimit || batchSize;
        let isComplete = false;

        if (prevNewUnique.length === 0) {
          // No new unique results.
          // For 'all' time, only mark complete after the primary relay has
          // answered with nothing new over multiple consecutive pages — a
          // single page of duplicates (e.g. a relay ignoring 'until', or an
          // unlucky timeout window) is not proof of end-of-data.
          if (timeRange === 'all') {
            isComplete = answeredZeroStreakRef.current >= 3;
          } else {
            isComplete = true;
          }
        } else if (timeRange === 'all') {
          // For 'all' time, don't mark complete based on count alone.
          // A batch might return fewer results than requested due to
          // network timeout (especially on mobile), not because we've
          // reached the end of the data. Only mark complete when a
          // subsequent batch returns 0 new results (handled above).
          // The pagination cursor (until = oldest - 1) ensures we keep
          // fetching older data until the relay genuinely has nothing left.
          isComplete = false;
        } else {
          // If we got fewer new results than expected, we've reached the end
          isComplete = prevNewUnique.length < expectedBatchSize;

          // Also check time boundary for safety with preset ranges
          if (!isComplete && timeRange !== 'custom') {
            const oldestNewReceipt = Math.min(...prevNewUnique.map(r => r.created_at));
            const BOUNDARY_TOLERANCE_SECONDS = 3600; // 1 hour tolerance
            if (oldestNewReceipt <= (since + BOUNDARY_TOLERANCE_SECONDS)) {
              isComplete = true;
            }
          }
        }

        return {
          ...prev,
          receipts: filteredReceipts,
          allReceiptsCache: allReceipts,
          isLoading: false,
          isComplete,
          currentBatch: prev.currentBatch + 1,
          totalFetched: filteredReceipts.length,
          relayLimit: detectedLimit,
          consecutiveFailures: 0, // Reset failures on success
          consecutiveZeroResults: prevNewUnique.length === 0 ? prev.consecutiveZeroResults + 1 : 0, // Track zero results
        };
      });

      // Schedule next automatic batch if appropriate
      if (isAutomatic) {
        // Continue auto-loading as long as we got NEW results.
        // Using newUnique (deduplicated) prevents infinite loops where
        // the relay keeps returning the same cached receipts.
        // EXCEPTION: for 'all' time, if we got 0 events (likely timeout),
        // keep retrying — the relay may have more data that just didn't
        // arrive in time. The isComplete logic above ensures we stop when
        // the relay genuinely returns all duplicates (end of data).
        const shouldContinueAutoLoad = newUnique.length > 0 ||
          (timeRange === 'all' && validReceipts.length === 0 && !stateRef.current.isComplete);

        if (shouldContinueAutoLoad) {
          scheduleAutoLoad('auto', ZAP_FETCH_CONFIG.BATCH_DELAY_MS);
        } else {
          // Ensure isLoadingRef is set to false when auto-loading stops
          isLoadingRef.current = false;
        }
      }

    } catch (error) {
      console.warn('Zap batch failed:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        consecutiveFailures: prev.consecutiveFailures + 1,
        // Disable auto-loading if we hit too many failures
        autoLoadEnabled: prev.consecutiveFailures + 1 < ZAP_FETCH_CONFIG.MAX_CONSECUTIVE_FAILURES,
      }));
    } finally {
      // Always ensure loading state is cleared
      isLoadingRef.current = false;
    }
  }, [nostr, pubkey, timeRange, customRange, nip65ReadRelays, scheduleAutoLoad]);

  // Keep the ref current so owned timeouts always call the latest closure
  loadMoreZapsRef.current = loadMoreZaps;

  // Auto-start loading when switching to a time range that needs more data
  useEffect(() => {
    if (!pubkey) return;

    // Get fresh state to avoid closures
    const currentState = stateRef.current;
    const { since, until } = getDateRange(timeRange, customRange);
    const isCustomRange = timeRange === 'custom';

    // Calculate cache coverage fresh (don't rely on potentially stale state)
    const userCache = userZapCache.get(pubkey) || [];
    const oldestCachedTimestamp = userCache.length > 0
      ? Math.min(...userCache.map(r => r.created_at))
      : 0;

    // For custom ranges, check if we need to load data based on cache coverage
    if (isCustomRange) {
      const cacheCoversCustomRange = userCache.length > 0 && oldestCachedTimestamp <= since;
      if (cacheCoversCustomRange) return;
    }

    // Calculate the correct data for the current time range
    let hasDataForTimeRange: boolean;
    let isCompleteForThisRange: boolean;

    if (isCustomRange) {
      // For custom ranges, calculate based on the filtered data within the custom range
      const filteredForCustomRange = userCache.filter(receipt =>
        receipt.created_at >= since && receipt.created_at <= (until || Date.now() / 1000)
      );
      hasDataForTimeRange = filteredForCustomRange.length > 0;
      // For custom ranges, we're complete if cache covers the range
      isCompleteForThisRange = userCache.length > 0 && oldestCachedTimestamp <= since;
    } else {
      // For preset ranges, use the existing logic
      hasDataForTimeRange = currentState.receipts.length > 0;
      isCompleteForThisRange = currentState.isComplete;
    }

    // Need to load more data if:
    // 1. No data for current time range, OR
    // 2. Have data but oldest cached data is newer than time range start
    const needsMoreData = !hasDataForTimeRange ||
      (hasDataForTimeRange && oldestCachedTimestamp > since);

    const shouldStartLoading = needsMoreData &&
      !currentState.isLoading &&
      !isCompleteForThisRange &&
      currentState.autoLoadEnabled;

    if (shouldStartLoading) {
      // For custom ranges, trigger immediately to avoid cleanup race conditions
      if (isCustomRange) {
        setTimeout(() => {
          loadMoreZaps(true).catch(error => {
            console.error('Auto-load failed for custom range:', error);
          });
        }, 100);
      } else {
        scheduleAutoLoad('effect-start', ZAP_FETCH_CONFIG.AUTO_LOAD_DELAY_MS);
      }
    }

    // Cleanup only timeouts this effect scheduled — never the auto-load
    // continuation scheduled by loadMoreZaps itself.
    return () => {
      if (!isCustomRange) {
        clearOwnedAutoLoad('effect-start');
      }
    };
  // state.isComplete is needed in deps because the cache-filter effect
  // (above) updates isComplete when timeRange changes. Without this dep,
  // this auto-start effect reads stale isComplete from stateRef and
  // incorrectly skips loading (e.g. switching from '7d' to 'all' where
  // the old isComplete=true hasn't been updated to false yet).
  }, [pubkey, timeRange, customRange, loadMoreZaps, state.isComplete, scheduleAutoLoad, clearOwnedAutoLoad]);

  // Additional effect to handle time range changes that need extended data
  useEffect(() => {
    if (!pubkey) return;

    // Get fresh state
    const currentState = stateRef.current;
    const { since } = getDateRange(timeRange, customRange);
    const isCustomRange = timeRange === 'custom';

    // For custom ranges, only load if cache doesn't cover the time range
    if (isCustomRange) {
      const oldestCachedTimestamp = currentState.allReceiptsCache.length > 0
        ? Math.min(...currentState.allReceiptsCache.map(r => r.created_at))
        : 0;

      const cacheCoversCustomRange = currentState.allReceiptsCache.length > 0 && oldestCachedTimestamp <= since;
      if (cacheCoversCustomRange) return;
    }

    const oldestCachedTimestamp = currentState.allReceiptsCache.length > 0
      ? Math.min(...currentState.allReceiptsCache.map(r => r.created_at))
      : 0;

    // CRITICAL FIX: Add tolerance check here too to prevent infinite loops
    const BOUNDARY_TOLERANCE_SECONDS = 14400; // 4 hours tolerance (increased from 3600)
    const withinBoundaryTolerance = oldestCachedTimestamp <= (since + BOUNDARY_TOLERANCE_SECONDS);

    // Specifically handle extending time ranges (when we have data but need older data)
    // ENHANCED: Also check consecutive zero results to prevent infinite loops
    const maxConsecutiveZeroResults = 3; // Stop after 3 consecutive zero-result batches
    const needsExtendedData = currentState.receipts.length > 0 &&
      oldestCachedTimestamp > since &&
      !withinBoundaryTolerance && // NEW: Don't trigger if within tolerance
      !currentState.isLoading &&
      !currentState.isComplete &&
      currentState.autoLoadEnabled &&
      currentState.consecutiveZeroResults < maxConsecutiveZeroResults; // NEW: Stop if too many zero results

    if (needsExtendedData) {
      scheduleAutoLoad('effect-extend', ZAP_FETCH_CONFIG.AUTO_LOAD_DELAY_MS * 2);
    }

    return () => {
      clearOwnedAutoLoad('effect-extend');
    };
  }, [pubkey, timeRange, customRange, state.receipts.length, state.allReceiptsCache.length, state.isLoading, state.isComplete, state.autoLoadEnabled, state.consecutiveZeroResults, loadMoreZaps, scheduleAutoLoad, clearOwnedAutoLoad]);

  // Function to manually trigger loading (for load more button)
  const manualLoadMore = useCallback(() => {
    loadMoreZaps(false);
  }, [loadMoreZaps]);

  // Function to toggle automatic loading
  const toggleAutoLoad = useCallback(() => {
    setState(prev => ({ ...prev, autoLoadEnabled: !prev.autoLoadEnabled }));
  }, []);

  // Function to restart auto loading (reset failures and enable)
  const restartAutoLoad = useCallback(() => {
    setState(prev => ({
      ...prev,
      autoLoadEnabled: true,
      consecutiveFailures: 0,
      consecutiveZeroResults: 0 // Reset zero results counter too
    }));
    answeredZeroStreakRef.current = 0;

    // If we're not loading and not complete, start loading
    const currentState = stateRef.current;
    if (!currentState.isLoading && !currentState.isComplete) {
      scheduleAutoLoad('auto', ZAP_FETCH_CONFIG.AUTO_LOAD_DELAY_MS);
    }
  }, [scheduleAutoLoad]);

  return {
    ...state,
    loadMoreZaps: manualLoadMore,
    toggleAutoLoad,
    restartAutoLoad,
  };
}

/**
 * Global cache for content events
 */
const contentEventCache = new Map<string, NostrEvent>();

/**
 * Fetch content events that were zapped
 */
export function useZappedContent(zapReceipts: ZapReceipt[]) {
  const { nostr } = useNostr();

  const eventIds = zapReceipts
    .map(receipt => receipt.tags.find(tag => tag[0] === 'e')?.[1])
    .filter((id): id is string => !!id);

  return useQuery({
    queryKey: ['zapped-content', eventIds.sort()],
    queryFn: async (c) => {
      if (eventIds.length === 0) return new Map<string, NostrEvent>();

      // Start with cached events
      const eventMap = new Map<string, NostrEvent>();
      const uncachedEventIds: string[] = [];

      // Check which events we already have cached
      eventIds.forEach(eventId => {
        if (contentEventCache.has(eventId)) {
          eventMap.set(eventId, contentEventCache.get(eventId)!);
        } else {
          uncachedEventIds.push(eventId);
        }
      });

      if (uncachedEventIds.length === 0) return eventMap;

      const signal = AbortSignal.any([
        c.signal,
        AbortSignal.timeout(12000)]); // Reduced timeout for faster failure detection

      // Use larger chunks and parallel processing for much faster loading
      const chunkSize = 150; // Increased chunk size significantly
      const maxConcurrent = 3; // Limit concurrent requests to avoid overwhelming relay
      const chunks: string[][] = [];
      for (let i = 0; i < uncachedEventIds.length; i += chunkSize) {
        chunks.push(uncachedEventIds.slice(i, i + chunkSize));
      }

      const processChunk = async (chunk: string[]): Promise<NostrEvent[]> => {
        try {
          return await nostr.query([{ ids: chunk }], { signal });
        } catch (error) {
          console.warn('Content chunk fetch failed:', error);
          return [];
        }
      };

      const allEvents: NostrEvent[] = [];

      // Process chunks in batches with limited concurrency
      for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batch = chunks.slice(i, i + maxConcurrent);
        const batchPromises = batch.map((chunk) => processChunk(chunk));

        try {
          const batchResults = await Promise.all(batchPromises);
          batchResults.forEach(events => allEvents.push(...events));

          // Very small delay between batches to be nice to the relay
          if (i + maxConcurrent < chunks.length) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } catch (error) {
          console.warn(`Content batch ${Math.floor(i / maxConcurrent) + 1} failed:`, error);
          // Continue with next batch
        }
      }

      // Update both local map and global cache
      allEvents.forEach(event => {
        eventMap.set(event.id, event);
        contentEventCache.set(event.id, event);
      });

      return eventMap;
    },
    enabled: eventIds.length > 0,
    staleTime: 1800000, // 30 minutes - content doesn't change often, especially old content
    retry: 1, // Add query retry
    retryDelay: 1000, // Reduced retry delay
  });
}

/**
 * Fetch author profiles for zappers and content creators
 */
export function useZapperProfiles(pubkeys: string[]) {
  const { nostr } = useNostr();

  const uniquePubkeys = Array.from(new Set(pubkeys));

  return useQuery({
    queryKey: ['zapper-profiles', uniquePubkeys.sort()],
    queryFn: async (c) => {
      if (uniquePubkeys.length === 0) return new Map<string, Record<string, unknown>>();

      // Start with cached profiles
      const profileMap = new Map<string, Record<string, unknown>>();
      const uncachedPubkeys: string[] = [];

      // Check which profiles we already have cached
      uniquePubkeys.forEach(pubkey => {
        if (profileCache.has(pubkey)) {
          profileMap.set(pubkey, profileCache.get(pubkey)!);
        } else {
          uncachedPubkeys.push(pubkey);
        }
      });

      if (uncachedPubkeys.length === 0) return profileMap;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(15000)]); // Reduced timeout for faster failure detection

      // Use larger chunks and parallel processing for much faster loading
      const chunkSize = 100; // Increased chunk size significantly
      const maxConcurrent = 3; // Limit concurrent requests to avoid overwhelming relay
      const chunks: string[][] = [];
      for (let i = 0; i < uncachedPubkeys.length; i += chunkSize) {
        chunks.push(uncachedPubkeys.slice(i, i + chunkSize));
      }

      const allProfiles: NostrEvent[] = [];

      const processChunk = async (chunk: string[]): Promise<NostrEvent[]> => {
        try {
          return await nostr.query([{ kinds: [0], authors: chunk }], { signal });
        } catch (error) {
          console.warn('Profile chunk fetch failed:', error);
          return [];
        }
      };

      // Process chunks in batches with limited concurrency
      for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batch = chunks.slice(i, i + maxConcurrent);
        const batchPromises = batch.map((chunk) => processChunk(chunk));

        try {
          const batchResults = await Promise.all(batchPromises);
          batchResults.forEach(profiles => allProfiles.push(...profiles));

          // Small delay between batches to be nice to the relay, but much shorter
          if (i + maxConcurrent < chunks.length) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } catch (error) {
          console.warn(`Batch ${Math.floor(i / maxConcurrent) + 1} failed:`, error);
          // Continue with next batch
        }
      }

      // Process fetched profiles and update both local map and global cache
      allProfiles.forEach(profile => {
        try {
          const metadata = JSON.parse(profile.content);
          profileMap.set(profile.pubkey, metadata);
          profileCache.set(profile.pubkey, metadata); // Update global cache
        } catch (error) {
          console.warn('Failed to parse profile metadata:', error);
        }
      });

      return profileMap;
    },
    enabled: uniquePubkeys.length > 0,
    staleTime: 600000, // 10 minutes since profiles don't change often
  });
}

/**
 * Main hook that combines all zap data and provides analytics with progressive loading
 */
export function useZapAnalytics(timeRange: TimeRange = '7d', customRange?: CustomDateRange, targetPubkey?: string) {
  // Don't start loading data for custom range until both dates are selected
  const shouldQueryData = timeRange !== 'custom' || (customRange?.from && customRange?.to);

  const progressiveData = useProgressiveZapReceipts(
    shouldQueryData ? timeRange : '7d', // fallback to 7d when custom is incomplete
    shouldQueryData ? customRange : undefined,
    targetPubkey
  );

  const {
    data: contentMap = new Map(),
    isLoading: _contentLoading
  } = useZappedContent(progressiveData.receipts);

  // Get all unique pubkeys for profile fetching
  const zapperPubkeys = progressiveData.receipts
    .map(receipt => {
      // Try to get pubkey from zap request description first
      const desc = receipt.tags.find(tag => tag[0] === 'description')?.[1];
      if (desc) {
        try {
          const zapRequest = JSON.parse(desc);
          return zapRequest.pubkey;
        } catch {
          // Ignore parsing errors
        }
      }
      return receipt.pubkey;
    })
    .filter((pubkey): pubkey is string => !!pubkey);

  const contentAuthorPubkeys = Array.from(contentMap.values())
    .map(event => event.pubkey);

  const allPubkeys = [...zapperPubkeys, ...contentAuthorPubkeys];

  const {
    data: profileMap = new Map(),
    isLoading: _profilesLoading
  } = useZapperProfiles(allPubkeys);

  // loadingState is returned DIRECTLY from progressiveData, not through
  // react-query. This ensures the loading animation updates instantly when
  // a batch starts/ends, without waiting for react-query to refetch.
  const loadingState = {
    isLoading: progressiveData.isLoading || _contentLoading || _profilesLoading,
    isComplete: progressiveData.isComplete && !_contentLoading && !_profilesLoading,
    totalFetched: progressiveData.totalFetched,
    relayLimit: progressiveData.relayLimit,
    canLoadMore: !progressiveData.isComplete && !progressiveData.isLoading,
    loadMoreZaps: progressiveData.loadMoreZaps,
    autoLoadEnabled: progressiveData.autoLoadEnabled,
    consecutiveFailures: progressiveData.consecutiveFailures,
    toggleAutoLoad: progressiveData.toggleAutoLoad,
    restartAutoLoad: progressiveData.restartAutoLoad,
  };

  const query = useQuery({
    queryKey: ['zap-analytics', timeRange, customRange, progressiveData.totalFetched, progressiveData.isComplete, contentMap.size, profileMap.size, shouldQueryData],
    queryFn: async (): Promise<AnalyticsData> => {
      // If custom range is incomplete, return empty analytics
      if (timeRange === 'custom' && (!customRange?.from || !customRange?.to)) {
        return {
          totalEarnings: 0,
          totalZaps: 0,
          uniqueZappers: 0,
          period: timeRange,
          earningsByPeriod: [],
          topContent: [],
          earningsByKind: [],
          topZappers: [],
          allZaps: [],
          temporalPatterns: {
            earningsByHour: [],
            earningsByDayOfWeek: [],
          },
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

      // Parse all zap receipts
      const parsedZaps: ParsedZap[] = progressiveData.receipts
        .map(parseZapReceipt)
        .filter((zap): zap is ParsedZap => zap !== null);

      // Enrich with content and profile data
      parsedZaps.forEach(zap => {
        // Add content event details
        if (zap.zappedEvent && contentMap.has(zap.zappedEvent.id)) {
          const event = contentMap.get(zap.zappedEvent.id)!;
          zap.zappedEvent = {
            ...zap.zappedEvent,
            kind: event.kind,
            author: event.pubkey,
            content: event.content,
            created_at: event.created_at,
          };
        }

        // Add zapper profile data
        if (profileMap.has(zap.zapper.pubkey)) {
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
      });

      // Calculate analytics
      const totalEarnings = parsedZaps.reduce((sum, zap) => sum + zap.amount, 0);
      const totalZaps = parsedZaps.length;

      // Calculate unique zappers count by getting all unique pubkeys
      const uniqueZapperPubkeys = new Set(parsedZaps.map(zap => zap.zapper.pubkey));
      const uniqueZappers = uniqueZapperPubkeys.size;

      const earningsByPeriod = groupZapsByPeriod(parsedZaps, timeRange, customRange);
      const topContent = groupZapsByContent(parsedZaps).slice(0, 5);
      const earningsByKind = groupZapsByKind(parsedZaps);
      const topZappers = getTopZappers(parsedZaps).slice(0, 5);

      // Calculate new analytics
      const temporalPatterns = {
        earningsByHour: groupZapsByHour(parsedZaps),
        earningsByDayOfWeek: groupZapsByDayOfWeek(parsedZaps),
      };

      const zapperLoyalty = analyzeZapperLoyalty(parsedZaps);
      const contentPerformance = analyzeContentPerformance(parsedZaps).slice(0, 10); // Top 10 performing content

      // Content creator analytics
      const hashtagPerformance = analyzeHashtagPerformance(parsedZaps);

      return {
        totalEarnings,
        totalZaps,
        uniqueZappers,
        period: timeRange,
        earningsByPeriod,
        topContent,
        earningsByKind,
        topZappers,
        allZaps: parsedZaps,
        temporalPatterns,
        zapperLoyalty,
        contentPerformance,
        hashtagPerformance,
      };
    },
    enabled: Boolean(shouldQueryData),
    staleTime: ZAP_FETCH_CONFIG.STALE_TIME,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    // Keep previous data visible while refetching (e.g. when totalFetched
    // changes after a new batch loads). Without this, react-query sets
    // isLoading=true and clears the data on every queryKey change, causing
    // all components to flash skeletons on every batch.
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    data: query.data,
    // loadingState is computed directly from progressiveData (not through
    // react-query) so it updates instantly when batch loading starts/stops.
    loadingState,
  };
}