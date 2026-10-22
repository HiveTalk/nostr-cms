import { useMutation } from "@tanstack/react-query";
import { uploadMediaFile } from "@/lib/mediaProcessing";
import { useAppContext } from "./useAppContext";
import { useCurrentUser } from "./useCurrentUser";

export function useUploadFile() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user) {
        throw new Error('Must be logged in to upload files');
      }

      const storedRelays = config.siteConfig?.blossomRelays || [];
      const excludedRelays = config.siteConfig?.excludedBlossomRelays || [];
      const defaultRelay = config.siteConfig?.defaultRelay;

      const relays = [...storedRelays];
      if (defaultRelay) {
        let normalizedDefault = defaultRelay.replace(/\/$/, '');
        if (normalizedDefault.startsWith('wss://')) {
          normalizedDefault = normalizedDefault.replace('wss://', 'https://');
        } else if (normalizedDefault.startsWith('ws://')) {
          normalizedDefault = normalizedDefault.replace('ws://', 'http://');
        }

        const isExcluded = excludedRelays.includes(normalizedDefault);

        if ((normalizedDefault.startsWith('http://') || normalizedDefault.startsWith('https://')) && !relays.includes(normalizedDefault) && !isExcluded) {
          relays.unshift(normalizedDefault);
        }
      }

      // Warn when no Blossom server is configured — the fallback silently
      // ships uploads to a third-party public server. Deployments should
      // configure blossomRelays rather than rely on it.
      if (relays.length === 0) {
        console.warn('No Blossom server configured — falling back to blossom.primal.net');
      }

      const { tags } = await uploadMediaFile(
        file,
        relays.length > 0 ? relays : ['https://blossom.primal.net/'],
        user.signer,
      );
      return tags;
    },
  });
}