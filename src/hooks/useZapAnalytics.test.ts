import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import type { DetailedFanoutResult, FanoutSource } from '@/lib/queryRelays';
import { useZapAnalytics } from './useZapAnalytics';

const PUBKEY = 'a'.repeat(64);
const EXTRA_RELAY = 'wss://extra.example';

// Scripted fanout — each test queues DetailedFanoutResult responses.
const { fanoutMock } = vi.hoisted(() => ({ fanoutMock: vi.fn() }));

vi.mock('@/lib/queryRelays', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queryRelays')>();
  return {
    ...actual,
    queryWithNip65FanoutDetailed: (...args: unknown[]) => fanoutMock(...args),
  };
});

// Make every bolt11 tag decode to 21 sats so fake receipts are valid.
vi.mock('light-bolt11-decoder', () => ({
  decode: () => ({ sections: [{ name: 'amount', value: 21000 }] }),
}));

vi.mock('@nostrify/react', () => ({
  useNostr: () => ({
    nostr: {
      query: vi.fn(async () => []),
      relay: () => ({ query: vi.fn(async () => []) }),
    },
  }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: PUBKEY } }),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      relayMetadata: { relays: [{ url: EXTRA_RELAY, read: true, write: true }] },
    },
  }),
}));

let counter = 0;
function receipt(created_at: number): NostrEvent {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, '0'),
    pubkey: 'b'.repeat(64),
    created_at,
    kind: 9735,
    tags: [['bolt11', 'lnbc210n1fake'], ['p', PUBKEY]],
    content: '',
    sig: 'c'.repeat(128),
  };
}

function source(status: 'fulfilled' | 'rejected', events: NostrEvent[], url = 'default'): FanoutSource {
  return { url, status, events };
}

function page(primary: FanoutSource, ...extra: FanoutSource[]): DetailedFanoutResult {
  const sources = [primary, ...extra];
  const events = Array.from(
    new Map(sources.flatMap(s => s.events).map(e => [e.id, e])).values(),
  );
  return { events, sources };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Advance fake timers until the fanout mock stops being called (or max rounds). */
async function drainBatches(expectedCalls: number) {
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    if (fanoutMock.mock.calls.length >= expectedCalls) return;
  }
}

/** The `until` value the nth (1-indexed) fanout call was made with. */
function callUntil(n: number): number | undefined {
  const filters = fanoutMock.mock.calls[n - 1][1] as NostrFilter[];
  return filters[0].until;
}

describe('useZapAnalytics all-time pagination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fanoutMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps paginating past an all-duplicates page until the primary confirms exhaustion 3x', async () => {
    const newest = [receipt(100), receipt(90)];
    const older = [receipt(70), receipt(60)];

    fanoutMock
      // Batch 1: primary has the newest receipts
      .mockResolvedValueOnce(page(source('fulfilled', newest), source('fulfilled', [], EXTRA_RELAY)))
      // Batch 2: primary missed this window; extra returns until-violating dupes.
      // Old code marked complete here (dupes > 0 = "end of data") and lost `older`.
      .mockResolvedValueOnce(page(source('fulfilled', []), source('fulfilled', newest, EXTRA_RELAY)))
      // Batch 3: primary delivers older receipts — proof batch 2 wasn't the end
      .mockResolvedValueOnce(page(source('fulfilled', older), source('fulfilled', newest, EXTRA_RELAY)))
      // Batches 4-6: three consecutive answered zero-new pages → complete
      .mockResolvedValue(page(source('fulfilled', []), source('fulfilled', newest, EXTRA_RELAY)));

    const { result } = renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(6);

    expect(fanoutMock).toHaveBeenCalledTimes(6);
    expect(result.current.loadingState.totalFetched).toBe(4);
    expect(result.current.loadingState.isComplete).toBe(true);
  });

  it('does not count zero-new pages where the primary relay was aborted', async () => {
    const newest = [receipt(100), receipt(90)];
    const older = [receipt(70)];

    fanoutMock
      .mockResolvedValueOnce(page(source('fulfilled', newest)))
      // Primary timed out — inconclusive, must not burn a completion strike
      .mockResolvedValueOnce(page(source('rejected', []), source('rejected', [], EXTRA_RELAY)))
      .mockResolvedValueOnce(page(source('fulfilled', older)))
      .mockResolvedValue(page(source('fulfilled', [])));

    const { result } = renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    // 1 + 1 + 1 + 3 answered-zero pages = 6 calls to completion
    await drainBatches(6);

    expect(fanoutMock).toHaveBeenCalledTimes(6);
    expect(result.current.loadingState.totalFetched).toBe(3);
    expect(result.current.loadingState.isComplete).toBe(true);
  });

  it('drives the until cursor from the primary oldest, not the merged minimum', async () => {
    // Primary returns its newest page; a supplemental contributes a very old
    // receipt. Merged-min would set until=9 and skip primary events at 10-89.
    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(100), receipt(90)]),
        source('fulfilled', [receipt(10)], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(source('fulfilled', [])));

    renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(2);

    expect(fanoutMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(callUntil(2)).toBe(89); // 90 - 1, not 10 - 1
  });

  it('counts each receipt once when multiple relays return it', async () => {
    const shared = receipt(100);
    const extra = receipt(90);

    // sources contain raw per-relay events — the same receipt arriving from
    // two relays must not be appended twice (inflation bug).
    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [shared, extra]),
        source('fulfilled', [shared], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(source('fulfilled', [])));

    const { result } = renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(4); // 1 data page + 3 answered zero pages

    expect(result.current.loadingState.totalFetched).toBe(2);
  });

  it('stops auto-loading after 3 inconclusive pages without marking complete', async () => {
    fanoutMock
      .mockResolvedValueOnce(page(source('fulfilled', [receipt(100)])))
      // Everything below the cursor keeps timing out
      .mockResolvedValue(page(source('rejected', []), source('rejected', [], EXTRA_RELAY)));

    const { result } = renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(4);
    const callsAtStall = fanoutMock.mock.calls.length;

    // Keep advancing — no further batches should fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fanoutMock.mock.calls.length).toBe(callsAtStall);
    expect(result.current.loadingState.isComplete).toBe(false);
  });
});
