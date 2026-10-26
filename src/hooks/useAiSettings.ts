import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './useCurrentUser';
import { useDefaultRelay } from './useDefaultRelay';
import { useNostrPublish } from './useNostrPublish';
import { useAdminAuth } from './useRemoteNostrJson';
import { useAppContext } from './useAppContext';
import { useEncryptionProbe } from './useFollowBackup';
import { getDefaultRelayUrl } from '@/lib/relay';
import { withTimeout } from '@/lib/promiseTimeout';
import type { NostrEvent } from '@nostrify/nostrify';

/** AI assistant configuration, stored encrypted on the relay. */
export interface AiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_AI_BASE_URL = 'https://gateway.trytokenfactory.dev/v1';
export const DEFAULT_AI_MODEL = 'glm-5.3-flash';

const ENCRYPT_TIMEOUT_MS = 15_000;
const DECRYPT_TIMEOUT_MS = 15_000;

/**
 * Relay-scoped d-tag for the AI settings event (kind 30078). The event content
 * is NIP-44/NIP-04 encrypted to the master user's own pubkey, so the API key
 * is never readable by anyone else — including the relay operator.
 */
export function getAiSettingsDTag(): string {
  return `nostr-cms-ai-settings:${getDefaultRelayUrl()}`;
}

/**
 * Fetch the raw (still-encrypted) AI settings event authored by the master
 * user. Existence of the event is what makes the AI Helper appear in the
 * admin navigation — no decryption needed for the check.
 */
export function useAiSettingsEvent() {
  const { user } = useCurrentUser();
  const { isMaster, masterPubkey, isLoading: authLoading } = useAdminAuth(user?.pubkey);
  const { nostr } = useDefaultRelay();

  return useQuery<NostrEvent | null>({
    queryKey: ['ai-settings-event', masterPubkey],
    queryFn: async () => {
      if (!masterPubkey || !nostr) return null;
      const signal = AbortSignal.timeout(8000);
      const events = await nostr.query(
        [{ kinds: [30078], authors: [masterPubkey], '#d': [getAiSettingsDTag()], limit: 1 }],
        { signal },
      );
      return events[0] ?? null;
    },
    enabled: !authLoading && isMaster && !!masterPubkey && !!nostr,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Decrypted AI settings. Only resolves for the master user (the content is
 * encrypted to their pubkey). Returns null when no event exists or the signer
 * cannot decrypt it.
 */
export function useAiSettings() {
  const { user } = useCurrentUser();
  const { data: event } = useAiSettingsEvent();

  return useQuery<AiSettings | null>({
    queryKey: ['ai-settings', event?.id, user?.pubkey],
    queryFn: async () => {
      if (!event || !user?.signer) return null;

      let decrypted: string | null = null;
      if (user.signer.nip44) {
        try {
          decrypted = await withTimeout(
            user.signer.nip44.decrypt(user.pubkey, event.content),
            DECRYPT_TIMEOUT_MS,
            'Decryption timed out. Check that your signer is unlocked.',
          );
        } catch {
          decrypted = null;
        }
      }
      if (!decrypted && user.signer.nip04) {
        try {
          decrypted = await withTimeout(
            user.signer.nip04.decrypt(user.pubkey, event.content),
            DECRYPT_TIMEOUT_MS,
            'Decryption timed out. Check that your signer is unlocked.',
          );
        } catch {
          decrypted = null;
        }
      }
      if (!decrypted) return null;

      try {
        const parsed = JSON.parse(decrypted) as Partial<AiSettings>;
        if (!parsed.apiKey) return null;
        return {
          apiKey: parsed.apiKey,
          baseUrl: parsed.baseUrl || DEFAULT_AI_BASE_URL,
          model: parsed.model || DEFAULT_AI_MODEL,
        };
      } catch {
        return null;
      }
    },
    enabled: !!event && !!user?.signer,
    staleTime: 60_000,
    retry: false,
  });
}

/** Encrypt and publish the AI settings as a replaceable kind 30078 event. */
export function useSaveAiSettings() {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { data: probe } = useEncryptionProbe();

  return useMutation({
    mutationFn: async (settings: AiSettings) => {
      if (!user?.signer) throw new Error('You must be logged in to save AI settings');
      if (!settings.apiKey.trim()) throw new Error('API key is required');

      const method = probe?.preferred;
      if (!method) {
        throw new Error(
          'Your signer does not support encrypted storage (NIP-44/NIP-04). ' +
          'Log in with an extension, bunker, or key that supports encryption.',
        );
      }

      const json = JSON.stringify(settings);
      const content = method === 'nip44'
        ? await withTimeout(
            user.signer.nip44!.encrypt(user.pubkey, json),
            ENCRYPT_TIMEOUT_MS,
            'Encryption timed out. Check that your signer is unlocked.',
          )
        : await withTimeout(
            user.signer.nip04!.encrypt(user.pubkey, json),
            ENCRYPT_TIMEOUT_MS,
            'Encryption timed out. Check that your signer is unlocked.',
          );

      await publishEvent({
        event: {
          kind: 30078,
          content,
          tags: [
            ['d', getAiSettingsDTag()],
            ['alt', 'nostr-cms AI assistant settings (encrypted)'],
          ],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings-event'] });
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
}

/** Who may use the AI Helper: only the master user, or every admin in nostr.json. */
export type AiHelperAccess = 'master' | 'admins';

export interface AiProxyStatus {
  /** True when the deployment has a server-side AI_API_KEY (api/ai functions). */
  enabled: boolean;
  defaultModel?: string;
}

/**
 * Probe the server-side AI proxy (`/api/ai/*` serverless functions). Disabled
 * when the site is served without them (plain `vite dev`, static hosting) —
 * the master user's personal encrypted key still works in that case.
 */
export function useAiProxyStatus() {
  return useQuery<AiProxyStatus>({
    queryKey: ['ai-proxy-status'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/ai/status', { signal: AbortSignal.timeout(6000) });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) {
          return { enabled: false };
        }
        const data = await res.json();
        return { enabled: !!data?.enabled, defaultModel: data?.defaultModel };
      } catch {
        return { enabled: false };
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Whether the current user may use the AI Helper, and how.
 *
 * - Master user: allowed with a personal encrypted key OR the server proxy.
 * - Other admins: allowed only when `ai_helper_access` = 'admins' in the site
 *   config AND the server proxy is enabled (they call the provider through
 *   `/api/ai/*` with NIP-98 auth — the key never reaches their browser).
 */
export function useAiAccess() {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { isAdmin, isMaster, isLoading: authLoading } = useAdminAuth(user?.pubkey);
  const { data: settingsEvent, isLoading: eventLoading } = useAiSettingsEvent();
  const { data: proxy, isLoading: proxyLoading } = useAiProxyStatus();

  const access: AiHelperAccess = config.siteConfig?.aiHelperAccess ?? 'master';
  const proxyEnabled = !!proxy?.enabled;

  const canUse = isMaster
    ? proxyEnabled || !!settingsEvent
    : !!isAdmin && access === 'admins' && proxyEnabled;

  return {
    canUse,
    access,
    proxyEnabled,
    isLoading: authLoading || proxyLoading || (isMaster && eventLoading),
  };
}

/** Remove the AI settings event from the relay (NIP-09 deletion). */
export function useClearAiSettings() {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { data: event } = useAiSettingsEvent();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('You must be logged in to remove AI settings');
      if (!event) throw new Error('No AI settings found to remove');

      await publishEvent({
        event: {
          kind: 5,
          content: 'Removing AI assistant settings',
          tags: [
            ['e', event.id],
            ['a', `30078:${user.pubkey}:${getAiSettingsDTag()}`],
            ['k', '30078'],
            ['alt', 'Delete AI assistant settings'],
          ],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings-event'] });
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
}
