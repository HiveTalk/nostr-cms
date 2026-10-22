import { useEffect, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { type AppConfig } from '@/contexts/AppContext';
import { getDefaultRelayUrl, getMasterPubkey, getSiteConfigDTag, LEGACY_SITE_CONFIG_DTAG } from '@/lib/relay';
import { isBlockedRelay } from '@/lib/blockedRelays';

/**
 * NostrSync - Syncs user's Nostr data
 *
 * This component runs globally to sync various Nostr data when the user logs in.
 * Currently syncs:
 * - NIP-65 relay list (kind 10002)
 * - Site configuration (kind 30078) from Master User
 */
export function NostrSync() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config, updateConfig } = useAppContext();
  const masterPubkey = getMasterPubkey();
  const hasSyncedConfig = useRef(false);

  // Sync logged-in user's data (e.g. relays)
  useEffect(() => {
    if (!user) return;

    const syncRelaysFromNostr = async () => {
      try {
        const events = await nostr.query(
          [{ kinds: [10002], authors: [user.pubkey], limit: 1 }],
          { signal: AbortSignal.timeout(5000) }
        );

        if (events.length > 0) {
          const event = events[0];

          // Only update if the event is newer than our stored data
          if (event.created_at > config.relayMetadata.updatedAt) {
            const fetchedRelays = event.tags
              .filter(([name]) => name === 'r')
              .map(([_, url, marker]) => ({
                url,
                read: !marker || marker === 'read',
                write: !marker || marker === 'write',
              }))
              .filter(r => !isBlockedRelay(r.url)); // Exclude blocked relays

            if (fetchedRelays.length > 0) {
              updateConfig((current) => ({
                ...current,
                relayMetadata: {
                  relays: fetchedRelays,
                  updatedAt: event.created_at,
                },
              }));
            }
          }
        }
      } catch (error) {
        console.error('[NostrSync] Failed to sync relays from Nostr:', error);
      }
    };

    syncRelaysFromNostr();
  }, [user, config.relayMetadata.updatedAt, nostr, updateConfig]);

  // Sync site configuration from Master User
  useEffect(() => {
    if (!masterPubkey || hasSyncedConfig.current) return;

    const syncSiteConfigFromMaster = async () => {
      try {
        // Get the current default relay (env var or auto-derived from domain)
        const envDefaultRelay = getDefaultRelayUrl();

        // Check if the environment variable relay differs from what's in localStorage
        const localStoredRelay = config.siteConfig?.defaultRelay;
        const relayHasChanged = envDefaultRelay && localStoredRelay && envDefaultRelay !== localStoredRelay;

        if (relayHasChanged) {
          // Update config to use the new relay from environment variable
          updateConfig((current) => ({
            ...current,
            siteConfig: {
              ...current.siteConfig,
              defaultRelay: envDefaultRelay,
              updatedAt: Math.floor(Date.now() / 1000),
            },
          }));

          hasSyncedConfig.current = true;
          return;
        }

        // Query with relay-scoped d-tag first (prevents cross-site config bleed)
        const scopedDTag = getSiteConfigDTag();
        let events = await nostr.query(
          [{
            kinds: [30078],
            authors: [masterPubkey],
            '#d': [scopedDTag],
            limit: 1
          }],
          { signal: AbortSignal.timeout(5000) }
        );

        // Migration fallback: try legacy unscoped d-tag if no scoped config found
        if (events.length === 0) {
          events = await nostr.query(
            [{
              kinds: [30078],
              authors: [masterPubkey],
              '#d': [LEGACY_SITE_CONFIG_DTAG],
              limit: 1
            }],
            { signal: AbortSignal.timeout(5000) }
          );

          // Only accept legacy event if its default_relay matches our env var
          if (events.length > 0) {
            const legacyRelay = events[0].tags.find(([name]) => name === 'default_relay')?.[1];
            if (legacyRelay && envDefaultRelay && legacyRelay !== envDefaultRelay) {
              events = [];
            }
          }
        }

        if (events.length > 0) {
          const event = events[0];
          const loadedConfig: Record<string, string | boolean | number | string[] | Record<string, string> | undefined> = {};

          const tags = {
            title: 'title',
            logo: 'logo',
            favicon: 'favicon',
            ogImage: 'og_image',
            heroTitle: 'hero_title',
            heroSubtitle: 'hero_subtitle',
            heroBackground: 'hero_background',
            heroBackgroundType: 'hero_background_type',
            heroBackgroundColor: 'hero_background_color',
            heroTextColor: 'hero_text_color',
            heroBanner: 'hero_banner',
            defaultRelay: 'default_relay',
            tweakcnThemeUrl: 'tweakcn_theme_url'
          };

          const eventTags = event.tags || [];

          Object.entries(tags).forEach(([key, tagName]) => {
            const val = eventTags.find(([name]) => name === tagName)?.[1];
            if (val !== undefined) loadedConfig[key] = val;
          });

          const updatedAtTag = eventTags.find(([name]) => name === 'updated_at')?.[1];
          const eventUpdatedAt = updatedAtTag ? parseInt(updatedAtTag) : event.created_at;

          // Check if relay from Nostr event differs from environment variable
          const relayFromEvent = loadedConfig.defaultRelay as string | undefined;
          const eventRelayDiffersFromEnv = envDefaultRelay && relayFromEvent && envDefaultRelay !== relayFromEvent;

          if (eventRelayDiffersFromEnv) {
            // Override the relay from the event with the environment variable
            loadedConfig.defaultRelay = envDefaultRelay;
          }

          // Only update if the event is newer than our current local site config
          // BUT always apply when relay mismatch is detected (env var takes precedence)
          if (!eventRelayDiffersFromEnv && config.siteConfig?.updatedAt && eventUpdatedAt <= config.siteConfig.updatedAt) {
            hasSyncedConfig.current = true;
            return;
          }

          // Handle booleans and numbers
          const showEvents = eventTags.find(([name]) => name === 'show_events')?.[1];
          if (showEvents !== undefined) loadedConfig.showEvents = showEvents === 'true';

          const showBlog = eventTags.find(([name]) => name === 'show_blog')?.[1];
          if (showBlog !== undefined) loadedConfig.showBlog = showBlog === 'true';

          const showFeed = eventTags.find(([name]) => name === 'show_feed')?.[1];
          if (showFeed !== undefined) loadedConfig.showFeed = showFeed === 'true';

          const maxEvents = eventTags.find(([name]) => name === 'max_events')?.[1];
          if (maxEvents !== undefined) loadedConfig.maxEvents = parseInt(maxEvents);

          const maxBlogPosts = eventTags.find(([name]) => name === 'max_blog_posts')?.[1];
          if (maxBlogPosts !== undefined) loadedConfig.maxBlogPosts = parseInt(maxBlogPosts);

          const maxFeedNotes = eventTags.find(([name]) => name === 'max_feed_notes')?.[1];
          if (maxFeedNotes !== undefined) loadedConfig.maxFeedNotes = parseInt(maxFeedNotes);

          const feedNpubsTag = eventTags.find(([name]) => name === 'feed_npubs')?.[1];
          if (feedNpubsTag) {
            try {
              const parsed = JSON.parse(feedNpubsTag);
              if (Array.isArray(parsed)) loadedConfig.feedNpubs = parsed;
            } catch (e) {
              console.warn('[NostrSync] Failed to parse feed_npubs', e);
            }
          }

          const blogNpubsTag = eventTags.find(([name]) => name === 'blog_npubs')?.[1];
          if (blogNpubsTag) {
            try {
              const parsed = JSON.parse(blogNpubsTag);
              if (Array.isArray(parsed)) loadedConfig.blogNpubs = parsed;
            } catch (e) {
              console.warn('[NostrSync] Failed to parse blog_npubs', e);
            }
          }

          const feedReadTag = eventTags.find(([name]) => name === 'feed_read_from_publish_relays')?.[1];
          if (feedReadTag !== undefined) loadedConfig.feedReadFromPublishRelays = feedReadTag === 'true';

          const readOnlyTag = eventTags.find(([name]) => name === 'read_only_admin_access')?.[1];
          if (readOnlyTag !== undefined) loadedConfig.readOnlyAdminAccess = readOnlyTag === 'true';

          const autoHarvestTag = eventTags.find(([name]) => name === 'auto_harvest_24h')?.[1];
          if (autoHarvestTag !== undefined) loadedConfig.autoHarvest24h = autoHarvestTag === 'true';

          const nip19Gateway = eventTags.find(([name]) => name === 'nip19_gateway')?.[1];
          if (nip19Gateway !== undefined) loadedConfig.nip19Gateway = nip19Gateway;

          const heroButtonsTag = eventTags.find(([name]) => name === 'hero_buttons')?.[1];
          if (heroButtonsTag) {
            try {
              const parsed = JSON.parse(heroButtonsTag);
              if (Array.isArray(parsed)) loadedConfig.heroButtons = parsed;
            } catch (e) {
              console.warn('[NostrSync] Failed to parse hero_buttons', e);
            }
          }

          const sectionOrderTag = eventTags.find(([name]) => name === 'section_order')?.[1];
          if (sectionOrderTag) {
            try {
              const parsed = JSON.parse(sectionOrderTag);
              if (Array.isArray(parsed)) loadedConfig.sectionOrder = parsed;
            } catch (e) {
              console.warn('[NostrSync] Failed to parse section_order', e);
            }
          }

          const homepageSectionOrderTag = eventTags.find(([name]) => name === 'homepage_section_order')?.[1];
          if (homepageSectionOrderTag) {
            try {
              const parsed = JSON.parse(homepageSectionOrderTag);
              if (Array.isArray(parsed) && parsed.length > 0) loadedConfig.homepageSectionOrder = parsed;
            } catch (e) {
              console.warn('[NostrSync] Failed to parse homepage_section_order', e);
            }
          }

          const relaysTag = eventTags.find(([name]) => name === 'publish_relays')?.[1];
          if (relaysTag) {
            try {
              const parsed = JSON.parse(relaysTag);
              if (Array.isArray(parsed)) loadedConfig.publishRelays = parsed;
            } catch (e) {
              console.warn('[NostrSync] Failed to parse publish_relays', e);
            }
          }

          const adminRolesTag = eventTags.find(([name]) => name === 'admin_roles')?.[1];
          if (adminRolesTag) {
            try {
              const parsed = JSON.parse(adminRolesTag);
              if (parsed && typeof parsed === 'object') {
                // Migrate old role names: primary→publisher, secondary→user
                const migrated: Record<string, string> = {};
                for (const [pk, role] of Object.entries(parsed)) {
                  if (role === 'primary') migrated[pk] = 'publisher';
                  else if (role === 'secondary') migrated[pk] = 'user';
                  else migrated[pk] = role as string;
                }
                loadedConfig.adminRoles = migrated;
              }
            } catch (e) {
              console.warn('[NostrSync] Failed to parse admin_roles', e);
            }
          }

          // Load navigation from content
          let loadedNavigation: { id: string; name: string; href: string; isSubmenu: boolean; parentId?: string }[] | null = null;
          try {
            const parsedContent = JSON.parse(event.content);
            if (Array.isArray(parsedContent)) {
              loadedNavigation = parsedContent;
            } else if (parsedContent?.navigation && Array.isArray(parsedContent.navigation)) {
              loadedNavigation = parsedContent.navigation;
            }
          } catch (e) {
            console.warn('[NostrSync] Failed to parse navigation content', e);
          }

          updateConfig((current) => ({
            ...current,
            siteConfig: {
              ...current.siteConfig,
              ...loadedConfig,
              updatedAt: eventUpdatedAt,
            } as Partial<AppConfig['siteConfig']>,
            ...(loadedNavigation ? { navigation: loadedNavigation } : {}),
          }));
          hasSyncedConfig.current = true;
        }
      } catch (error) {
        console.error('[NostrSync] Failed to sync site config from master:', error);
      }
    };

    syncSiteConfigFromMaster();
  }, [masterPubkey, nostr, updateConfig, config.siteConfig?.updatedAt, config.siteConfig?.defaultRelay]);

  return null;
}