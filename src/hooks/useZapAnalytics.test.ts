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

describe('useZapAnalytics cursor edge cases (review findings)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fanoutMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('anchors the frontier to valid receipts, ignoring invalid outliers', async () => {
    const invalid = receipt(10);
    invalid.tags = []; // no bolt11 tag → fails isValidZapReceipt

    // Page with valid@100, valid@90 plus a malformed@10. A sparse or
    // garbled page can't prove contiguity — only valid receipts anchor
    // the frontier, so until=89 and any unreturned valid history between
    // 11 and 89 stays reachable.
    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(100), receipt(90), invalid]),
      ))
      .mockResolvedValue(page(source('fulfilled', [])));

    renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(2);

    expect(callUntil(2)).toBe(89);
  });

  it('does not mark an invalid-only primary page as proven empty', async () => {
    const invalid = receipt(80);
    invalid.tags = [];

    // Batch 1: primary in-window content is entirely invalid — not an
    // empty answer, so the supplemental cursor must not take over, and one
    // unconfirmed invalid page is not a trustworthy boundary (no until yet).
    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [invalid]),
        source('fulfilled', [receipt(10)], EXTRA_RELAY),
      ))
      // Batch 2: unconstrained retry — primary supplies a valid receipt,
      // which becomes the anchor for the next cursor.
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(70)]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(
        source('fulfilled', []),
        source('fulfilled', [], EXTRA_RELAY),
      ));

    renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(3);

    expect(callUntil(2)).toBeUndefined();
    expect(callUntil(3)).toBe(69);
  });

  it('advances past a confirmed invalid-only window after two consecutive pages', async () => {
    const invalid = receipt(80);
    invalid.tags = [];
    const invalid2 = receipt(79);
    invalid2.tags = [];

    // Two consecutive invalid-only pages confirm the window is junk —
    // only then does the raw boundary advance so older history below it
    // (valid@70 on batch 3) stays reachable.
    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [invalid]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValueOnce(page(
        source('fulfilled', [invalid2]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(70)]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(
        source('fulfilled', []),
        source('fulfilled', [], EXTRA_RELAY),
      ));

    const { result } = renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(3);

    expect(callUntil(3)).toBe(78);
    expect(result.current.loadingState.totalFetched).toBe(1);
  });

  it('keeps the filter unconstrained while the primary has never answered', async () => {
    // Batch 1: primary rejected, supplemental returns an old receipt at 10.
    // The next query must NOT use until=9 — a recovering primary still has
    // unqueried newer history above that timestamp.
    fanoutMock
      .mockResolvedValueOnce(page(
        source('rejected', []),
        source('fulfilled', [receipt(10)], EXTRA_RELAY),
      ))
      // Batch 2: primary recovers with newer receipts
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(90), receipt(80)]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(source('fulfilled', []), source('fulfilled', [], EXTRA_RELAY)));

    renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(2);

    expect(callUntil(2)).toBeUndefined();
  });

  it('lets the supplemental cursor lead once the primary is proven empty', async () => {
    // Batch 1: primary answers EMPTY (fulfilled, no events), supplemental
    // returns data. Primary has proven it holds nothing → mergedMin leads.
    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', []),
        source('fulfilled', [receipt(50), receipt(40)], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(source('fulfilled', []), source('fulfilled', [], EXTRA_RELAY)));

    renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(2);

    expect(callUntil(2)).toBe(39);
  });

  it('continues auto-loading through a within-window duplicates page', async () => {
    const shared = receipt(20);
    const newest = [receipt(100), receipt(90)];

    fanoutMock
      // Batch 1: primary newest; supplemental contributes shared@20
      .mockResolvedValueOnce(page(
        source('fulfilled', newest),
        source('fulfilled', [shared], EXTRA_RELAY),
      ))
      // Batch 2: primary returns only the already-cached shared@20 —
      // validReceipts nonempty but zero new. Must keep paginating.
      .mockResolvedValueOnce(page(
        source('fulfilled', [shared]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      // Batch 3: primary delivers older data below the dupe
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(10)]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(source('fulfilled', []), source('fulfilled', [], EXTRA_RELAY)));

    const { result } = renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(6);

    // 4 unique receipts reached — the dupe page did not stall pagination
    expect(result.current.loadingState.totalFetched).toBe(4);
  });

  it('gives an until-ignoring primary a bounded recovery before the supplemental cursor leads', async () => {
    // '7d' preset sets since+until boundaries. The primary ignores the until
    // boundary and keeps returning a future event. One violation is
    // inconclusive (batch 2 repeats the window — a recovering primary could
    // still supply its in-range history); a second consecutive violation is
    // confirmed and the merged cursor leads (batch 3: until=now-4001).
    // Supplemental returns full pages so the preset-range chain continues.
    const now = Math.floor(Date.now() / 1000);
    const outOfWindow = receipt(now + 100);
    const page1 = [...Array.from({ length: 99 }, (_, i) => receipt(now - 1000 - i)), receipt(now - 2000)];
    const page2 = [...Array.from({ length: 99 }, (_, i) => receipt(now - 3000 - i)), receipt(now - 4000)];

    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [outOfWindow]),
        source('fulfilled', page1, EXTRA_RELAY),
      ))
      .mockResolvedValueOnce(page(
        source('fulfilled', [outOfWindow]),
        source('fulfilled', page2, EXTRA_RELAY),
      ))
      .mockResolvedValue(page(
        source('fulfilled', [outOfWindow]),
        source('fulfilled', [], EXTRA_RELAY),
      ));

    renderHook(() => useZapAnalytics('7d', undefined, PUBKEY), { wrapper });

    await drainBatches(3);

    // Batch 2's until is still near the preset boundary — the fake clock
    // can drift a second between batches, so assert the range, not equality.
    expect(callUntil(2)).toBeGreaterThan(now - 100);
    expect(callUntil(3)).toBe(now - 4001);
  });

  it('does not spend the no-progress budget on frontier-advancing invalid pages', async () => {
    const i80 = receipt(80);
    i80.tags = [];
    const i79 = receipt(79);
    i79.tags = [];

    // valid@100, then two invalid-only pages at 80 (2nd advances cursor to
    // 79 — progress resets the no-progress count), then two at 79 (advance
    // to 78), then valid@70 becomes reachable. Without progress resets the
    // third zero-new page would have stopped auto-loading early.
    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(100)]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValueOnce(page(
        source('fulfilled', [i80]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValueOnce(page(
        source('fulfilled', [i80]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValueOnce(page(
        source('fulfilled', [i79]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValueOnce(page(
        source('fulfilled', [i79]),
        source('fulfilled', [], EXTRA_RELAY),
      ))
      .mockResolvedValue(page(
        source('fulfilled', [receipt(70)]),
        source('fulfilled', [], EXTRA_RELAY),
      ));

    const { result } = renderHook(() => useZapAnalytics('all', undefined, PUBKEY), { wrapper });

    await drainBatches(6);

    expect(callUntil(6)).toBe(78);
    expect(result.current.loadingState.totalFetched).toBe(2);
  });

  it('includes primary receipts when an until-violating primary recovers on the next batch', async () => {
    // The review scenario: batch 1 returns only a future event, a full
    // supplemental page continues the chain, and the primary recovers on
    // batch 2 with an in-range receipt — the window was held (no merged
    // cursor yet), so now-1500 is fetched, not skipped.
    const now = Math.floor(Date.now() / 1000);
    const recovered = receipt(now - 1500);
    const page1 = [...Array.from({ length: 99 }, (_, i) => receipt(now - 1000 - i)), receipt(now - 2000)];

    fanoutMock
      .mockResolvedValueOnce(page(
        source('fulfilled', [receipt(now + 100)]),
        source('fulfilled', page1, EXTRA_RELAY),
      ))
      .mockResolvedValue(page(
        source('fulfilled', [recovered]),
        source('fulfilled', [], EXTRA_RELAY),
      ));

    const { result } = renderHook(() => useZapAnalytics('7d', undefined, PUBKEY), { wrapper });

    await drainBatches(3);

    expect(result.current.loadingState.totalFetched).toBe(101);
    expect(callUntil(3)).toBe(now - 1501);
  });
});
