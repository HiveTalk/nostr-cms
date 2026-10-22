/**
 * Hook for creating NIP-18 reposts (kind 6 / kind 16).
 *
 * Supports:
 * - Immediate repost (publish now)
 * - Scheduled repost (publish at a future time via the scheduler)
 * - Repeating scheduled reposts (multiple reposts at regular intervals)
 *
 * Scheduled reposts use a two-phase approach:
 *   Phase 1 — sign all events upfront (no network calls).
 *   Phase 2 — schedule each signed event sequentially via the scheduler API.
 *
 * If any signing fails in Phase 1, nothing is scheduled — clean failure.
 * If some scheduling calls fail in Phase 2, the `failed` array in the result
 * contains the signed events that were not scheduled. The caller can retry
 * just those by passing them back via `preSignedEvents`.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { schedulePostViaApi } from './useScheduledPosts';
import { buildRepostEvent, type RepostTarget } from '@/lib/repost';
import type { NostrEvent } from '@/types/scheduled';

export interface RepeatConfig {
  count: number; // 1-10
  intervalMs: number; // milliseconds between reposts
}

/** A pre-signed event with its scheduled date, for retry use. */
export interface PreSignedRepost {
  signedEvent: NostrEvent;
  scheduledDate: Date;
}

export interface CreateRepostOptions {
  target: RepostTarget;
  relayUrl: string; // relay where the original event can be found
  scheduleFor?: Date | null; // if set, schedules; if null, publishes immediately
  publishRelays: string[]; // relays to publish/schedule to
  repeat?: RepeatConfig | null; // optional: schedule multiple reposts
  /** Pre-signed events to schedule (retry path — skips Phase 1 signing). */
  preSignedEvents?: PreSignedRepost[];
}

/** A scheduling failure with the signed event so the caller can retry. */
export interface ScheduleFailure {
  signedEvent: NostrEvent;
  scheduledDate: Date;
  error: string;
}

export interface CreateRepostResult {
  signedEvent: NostrEvent;
  scheduledPostIds: string[];
  failed: ScheduleFailure[];
}

export function useCreateRepost() {
  const { user } = useCurrentUser();
  const publishEvent = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation<CreateRepostResult, Error, CreateRepostOptions>({
    mutationFn: async (opts: CreateRepostOptions) => {
      if (!user) throw new Error('User is not logged in');

      const { target, relayUrl, scheduleFor, publishRelays, repeat, preSignedEvents } = opts;

      // --- Immediate repost (no scheduling) ---
      if (!scheduleFor && !preSignedEvents) {
        const createdAt = Math.floor(Date.now() / 1000);
        const unsigned = buildRepostEvent(target, relayUrl, createdAt);
        const signedEvent = await user.signer.signEvent(unsigned);
        await publishEvent.mutateAsync({
          event: {
            kind: signedEvent.kind,
            content: signedEvent.content,
            tags: signedEvent.tags,
            created_at: signedEvent.created_at,
          },
          relays: publishRelays,
        });
        return { signedEvent, scheduledPostIds: [], failed: [] };
      }

      // --- Scheduled repost(s) ---
      // We call the scheduler API directly instead of using useCreateScheduledPost,
      // because calling mutateAsync in a loop triggers onSuccess → query invalidation
      // → refetch on each iteration. The refetch signs a NIP-98 event via
      // window.nostr, which races with the next loop iteration's signing request.
      // Browser extensions can only handle one signing request at a time, so the
      // second request fails, causing all subsequent posts to be lost.
      // By calling the API directly and invalidating once at the end, we avoid
      // the race condition entirely.

      // Phase 1: Produce all signed events (either from pre-signed retry set
      // or by building and signing fresh). If any signing fails, throw
      // immediately — nothing has been scheduled yet.
      let toSchedule: PreSignedRepost[];

      if (preSignedEvents && preSignedEvents.length > 0) {
        // Retry path: events are already signed, skip straight to scheduling.
        toSchedule = preSignedEvents;
      } else {
        const count = repeat?.count ?? 1;
        const intervalMs = repeat?.intervalMs ?? 0;
        toSchedule = [];

        for (let i = 0; i < count; i++) {
          const scheduledDate = new Date(scheduleFor!.getTime() + i * intervalMs);
          const createdAt = Math.floor(scheduledDate.getTime() / 1000);
          const unsigned = buildRepostEvent(target, relayUrl, createdAt, {
            total: count,
            index: i,
            intervalMs,
          });
          const signedEvent = await user.signer.signEvent(unsigned);
          toSchedule.push({ signedEvent, scheduledDate });
        }
      }

      // Phase 2: Schedule each signed event sequentially. Catch per-iteration
      // errors so partial failures are reported without losing the events
      // that were already scheduled successfully.
      const scheduledPostIds: string[] = [];
      const failed: ScheduleFailure[] = [];
      let lastSignedEvent: NostrEvent | null = null;

      for (const { signedEvent, scheduledDate } of toSchedule) {
        lastSignedEvent = signedEvent;
        try {
          const result = await schedulePostViaApi({
            signedEvent,
            relays: publishRelays,
            scheduledFor: scheduledDate,
            user,
          });
          if (result?.id) {
            scheduledPostIds.push(result.id);
          }
        } catch (err) {
          failed.push({
            signedEvent,
            scheduledDate,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Invalidate the scheduled posts query ONCE after all posts are processed
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts', user.pubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts-stats', user.pubkey],
      });

      return {
        signedEvent: lastSignedEvent!,
        scheduledPostIds,
        failed,
      };
    },
  });
}
