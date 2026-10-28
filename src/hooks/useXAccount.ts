/**
 * Hook for the X (Twitter) crossposting feature backed by the Swarm relay.
 *
 * The relay implements the OAuth 1.0a 3-legged flow and stores per-user X
 * access tokens, then crossposts kind-1 notes authored by linked users —
 * covering both notes published over the websocket and notes published by the
 * scheduler. All endpoints are NIP-98 authed against the team member list.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { nip98Fetch } from '@/lib/nip98';
import { getSchedulerApiUrl } from '@/lib/scheduler';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const API_BASE = getSchedulerApiUrl();

export interface XAccountStatus {
  /** Whether the /api/x endpoints responded (false on 404/network error). */
  available: boolean;
  /** Whether the relay accepted our NIP-98 auth (false = not a team member). */
  unauthorized: boolean;
  /** Whether TWITTER_KEY/TWITTER_KEY_SECRET are set on the server. */
  configured: boolean;
  linked: boolean;
  enabled?: boolean;
  screen_name?: string;
  twitter_user_id?: string;
  linked_at?: string;
  last_posted_at?: string;
  last_error?: string;
}

const UNAVAILABLE: XAccountStatus = { available: false, unauthorized: false, configured: false, linked: false };

async function fetchXStatus(user: { pubkey: string; signer: Parameters<typeof nip98Fetch>[2]['signer'] }): Promise<XAccountStatus> {
  let res: Response;
  try {
    res = await nip98Fetch(`${API_BASE}/x/status`, { method: 'GET' }, user);
  } catch {
    return UNAVAILABLE;
  }
  if (res.status === 404) {
    return UNAVAILABLE;
  }
  if (res.status === 401 || res.status === 403) {
    // Endpoint exists but this pubkey isn't a relay team member.
    return { ...UNAVAILABLE, available: true, unauthorized: true };
  }
  if (!res.ok) {
    return UNAVAILABLE;
  }
  const data = (await res.json()) as Omit<XAccountStatus, 'available' | 'unauthorized'>;
  return { ...data, available: true, unauthorized: false };
}

export function useXStatus() {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ['x-account-status', user?.pubkey],
    queryFn: () => fetchXStatus(user!),
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Start the X OAuth flow. Returns the X authorize URL — the caller navigates
 * the browser to it; X calls back to the relay which redirects to
 * <origin>/admin/crosspost?x_linked=1.
 */
export function useXConnect() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<string> => {
      if (!user) throw new Error('Please login first');
      const res = await nip98Fetch(`${API_BASE}/x/auth/start`, {
        method: 'POST',
        body: JSON.stringify({ return_to: window.location.origin }),
      }, user);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to start X authorization (${res.status})`);
      }
      const data = (await res.json()) as { authorize_url: string };
      return data.authorize_url;
    },
    onSuccess: (authorizeUrl) => {
      queryClient.invalidateQueries({ queryKey: ['x-account-status'] });
      window.location.href = authorizeUrl;
    },
  });
}

export function useXDisconnect() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Please login first');
      const res = await nip98Fetch(`${API_BASE}/x/disconnect`, { method: 'POST' }, user);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to disconnect (${res.status})`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['x-account-status'] });
    },
  });
}

export function useXToggle() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!user) throw new Error('Please login first');
      const res = await nip98Fetch(`${API_BASE}/x/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }, user);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to update setting (${res.status})`);
      }
      return enabled;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['x-account-status'] });
    },
  });
}
