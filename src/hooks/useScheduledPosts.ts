/**
 * Hook for managing scheduled posts via Swarm Relay Backend
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ScheduledPost,
  CreateScheduledPostInput,
  ScheduledPostStats,
  ScheduledPostStatus,
  NostrEvent,
} from '@/types/scheduled';
import { getSchedulerApiUrl } from '@/lib/scheduler';

type NostrSigner = {
  getPublicKey: () => Promise<string>;
  signEvent: (event: Omit<NostrEvent, 'id' | 'sig'>) => Promise<NostrEvent>;
};

// API base URL - derived from VITE_SWARM_API_URL or VITE_DEFAULT_RELAY
const API_BASE = getSchedulerApiUrl();

/**
 * Fetch wrapper that adds NIP-98 Authorization header
 */
async function fetchWithNip98(urlStr: string, method: string, body?: unknown) {
  const url = urlStr.startsWith('http') ? urlStr : `${API_BASE}${urlStr}`;

  // 1. Create event kind 27235
  // We need to access window.nostr for signing
  const nostr = (window as Window & { nostr?: NostrSigner }).nostr;
  if (!nostr) {
    throw new Error('Nostr extension not found');
  }

  const pubkey = await nostr.getPublicKey();

  // Create the event structure
  // content, keys, created_at, kind, tags
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method],
    ],
    content: '',
    pubkey: pubkey,
  };

  // 2. Sign
  const signed = await nostr.signEvent(event);

  // 3. Create Authorization header
  const token = btoa(JSON.stringify(signed));

  // 4. Fetch with timeout to avoid indefinite hanging if the extension
  //    or network is slow/unresponsive.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Nostr ${token}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, options);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API Error: ${response.status} ${text}`);
  }

  // Handle 204 No Content or empty responses
  if (response.status === 204) {
    return null;
  }

  // Only try to parse JSON if there is content
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.indexOf("application/json") !== -1) {
    return response.json();
  }
  return response.text();
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Fetch all scheduled posts for a user
 */
export function useScheduledPosts(userPubkey: string | undefined, status?: string) {
  return useQuery({
    queryKey: ['scheduled-posts', userPubkey, status],
    queryFn: async () => {
      if (!userPubkey) return [];

      const posts = await fetchWithNip98('/scheduler/list', 'GET') as ScheduledPost[];

      // Filter by status if requested (API returns all)
      if (status) {
        return posts.filter(p => p.status === status);
      }

      // Sort by scheduled_for
      return posts.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
    },
    enabled: !!userPubkey,
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

/**
 * Derive stats from the useScheduledPosts query data.
 * This avoids a redundant NIP-98 signing round-trip to the same /scheduler/list
 * endpoint on every page load and every 30s refetch.
 */
export function useScheduledPostsStats(userPubkey: string | undefined) {
  const { data: posts } = useScheduledPosts(userPubkey);

  return useQuery({
    queryKey: ['scheduled-posts-stats', userPubkey, posts],
    queryFn: async () => {
      const stats: ScheduledPostStats = { pending: 0, published: 0, failed: 0 };
      (posts || []).forEach((post) => {
        if (post.status in stats) {
          stats[post.status as keyof ScheduledPostStats]++;
        }
      });
      return stats;
    },
    enabled: !!userPubkey,
    // Data is derived from useScheduledPosts, so we don't need to refetch
    // on a timer — it updates whenever the parent query updates.
    refetchInterval: false,
  });
}

/**
 * Fetch a single scheduled post by ID
 */
export function useScheduledPost(id: string | undefined) {
  return useQuery({
    queryKey: ['scheduled-post', id],
    queryFn: async () => {
      if (!id) return null;
      // Inefficient but API doesn't support get-by-id yet
      // We list all and find one. 
      const posts = await fetchWithNip98('/scheduler/list', 'GET') as ScheduledPost[];
      const post = posts.find(p => p.id === id);
      if (!post) throw new Error('Post not found');
      return post;
    },
    enabled: !!id,
  });
}

// ============================================================================
// Direct API helpers (no query invalidation — used by useCreateRepost loop)
// ============================================================================

/**
 * Schedule a post via the API directly, without triggering query invalidation.
 * Used by useCreateRepost when scheduling multiple repeating reposts in a loop,
 * to avoid race conditions with NIP-98 signing from concurrent refetches.
 */
export async function schedulePostViaApi(input: {
  signedEvent: NostrEvent;
  relays: string[];
  scheduledFor: Date;
}): Promise<ScheduledPost> {
  const body = {
    signed_event: input.signedEvent,
    relays: input.relays,
    scheduled_for: input.scheduledFor.toISOString(),
  };
  const result = await fetchWithNip98('/scheduler/schedule', 'POST', body);
  return result as ScheduledPost;
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new scheduled post
 */
export function useCreateScheduledPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateScheduledPostInput) => {
      return schedulePostViaApi(input);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts', variables.userPubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts-stats', variables.userPubkey],
      });
    },
  });
}

/**
 * Delete a scheduled post
 */
export function useDeleteScheduledPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, userPubkey: _userPubkey }: { id: string; userPubkey: string }) => {
      await fetchWithNip98(`/scheduler/delete?id=${id}`, 'DELETE');
      return id;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts', variables.userPubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts-stats', variables.userPubkey],
      });
    },
  });
}

/**
 * Result of a retry. `cleanupFailed` is set when a fresh copy was scheduled
 * but deleting the failed original errored — the caller should surface this
 * so the user removes the original instead of retrying into a duplicate.
 */
export interface RetryScheduledPostResult {
  post: ScheduledPost;
  cleanupFailed?: boolean;
}

/**
 * Retry a failed scheduled post. Two modes:
 * - Preserve (default): POST /scheduler/retry keeps the signed event —
 *   including its original created_at, so it publishes at its original
 *   position in timestamp-sorted feeds.
 * - Fresh copy: re-signs a clone with created_at set to the retry schedule
 *   (and refreshes any `published_at` tag), schedules it via the existing
 *   POST /scheduler/schedule, and deletes the failed original. Requires the
 *   NIP-07 signer at retry time; the new event lands at the retry position.
 *   The clone strips `repeat_*` tags — a retried entry no longer occupies
 *   its original slot in the series timeline, so it must not claim one.
 *
 * If the delete fails after the schedule succeeds, the result carries
 * `cleanupFailed` instead of throwing — the new post exists and must be
 * shown, and the failed original needs manual removal.
 */
export function useRetryScheduledPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      post,
      scheduledFor,
      freshCopy,
    }: {
      post: ScheduledPost;
      scheduledFor: Date;
      freshCopy?: boolean;
    }): Promise<RetryScheduledPostResult> => {
      if (!freshCopy) {
        const result = await fetchWithNip98(`/scheduler/retry?id=${post.id}`, 'POST', {
          scheduled_for: scheduledFor.toISOString(),
        });
        return { post: result as ScheduledPost };
      }

      const nostr = (window as Window & { nostr?: NostrSigner }).nostr;
      if (!nostr) {
        throw new Error('Nostr extension not found');
      }
      const createdAt = Math.floor(scheduledFor.getTime() / 1000);
      const { id: _id, sig: _sig, ...unsigned } = post.signed_event;
      unsigned.created_at = createdAt;
      unsigned.tags = unsigned.tags
        .filter((t) => !t[0].startsWith('repeat_'))
        .map((t) => (t[0] === 'published_at' ? ['published_at', String(createdAt)] : t));
      const signedEvent = await nostr.signEvent(unsigned);

      const created = await schedulePostViaApi({
        signedEvent,
        relays: post.relays,
        scheduledFor,
      });
      // The failed original is superseded by the fresh copy. A delete failure
      // is a partial success, not an error — the new scheduled post exists.
      try {
        await fetchWithNip98(`/scheduler/delete?id=${post.id}`, 'DELETE');
      } catch {
        return { post: created, cleanupFailed: true };
      }
      return { post: created };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] });
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts-stats'] });
    },
  });
}

/**
 * Clear scheduled post history for a specific status (published or failed)
 */
export function useClearScheduledPostsHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ids,
      userPubkey: _userPubkey,
      status,
    }: {
      ids: string[];
      userPubkey: string;
      status: ScheduledPostStatus;
    }) => {
      if (status === 'pending') {
        throw new Error('Clearing pending posts in bulk is not supported');
      }

      await Promise.all(ids.map((id) => fetchWithNip98(`/scheduler/delete?id=${id}`, 'DELETE')));
      return ids.length;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts', variables.userPubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts-stats', variables.userPubkey],
      });
    },
  });
}

/**
 * Update a scheduled post (for rescheduling)
 * Implemented as Delete old + Create new
 */
export function useUpdateScheduledPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      userPubkey: _userPubkey,
      updates,
    }: {
      id: string;
      userPubkey: string;
      updates: Partial<ScheduledPost>;
    }) => {

      // 1. Delete old post
      await fetchWithNip98(`/scheduler/delete?id=${id}`, 'DELETE');

      // 2. Create new post
      if (!updates.signed_event || !updates.scheduled_for || !updates.relays) {
        throw new Error("Missing required fields for update (signed_event, scheduled_for, relays)");
      }

      const body = {
        signed_event: updates.signed_event,
        relays: updates.relays,
        scheduled_for: updates.scheduled_for,
      };

      const result = await fetchWithNip98('/scheduler/schedule', 'POST', body);
      return result as ScheduledPost;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['scheduled-posts', variables.userPubkey],
      });
      queryClient.invalidateQueries({
        queryKey: ['scheduled-post', variables.id],
      });
    },
  });
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Calculate time remaining until scheduled publish
 */
export function getTimeRemaining(scheduledFor: string): {
  text: string;
  isPast: boolean;
  seconds: number;
} {
  const now = new Date();
  const scheduled = new Date(scheduledFor);
  const diff = scheduled.getTime() - now.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds <= 0) {
    return { text: 'Due now', isPast: true, seconds: 0 };
  }

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return {
      text: `in ${days} day${days > 1 ? 's' : ''}`,
      isPast: false,
      seconds,
    };
  }

  if (hours > 0) {
    return {
      text: `in ${hours} hour${hours > 1 ? 's' : ''}`,
      isPast: false,
      seconds,
    };
  }

  if (minutes > 0) {
    return {
      text: `in ${minutes} minute${minutes > 1 ? 's' : ''}`,
      isPast: false,
      seconds,
    };
  }

  return {
    text: `in ${seconds} second${seconds > 1 ? 's' : ''}`,
    isPast: false,
    seconds,
  };
}
