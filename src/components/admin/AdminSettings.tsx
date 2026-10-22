import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getDefaultRelayUrl, getSiteConfigDTag } from '@/lib/relay';
import { buildSiteConfigTags } from '@/lib/siteConfig';
import { Save, RotateCcw, RefreshCw, ShieldAlert, Eye, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useAdminAuth } from '@/hooks/useRemoteNostrJson';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { type SiteConfig, type NavigationItem, DEFAULT_SITE_CONFIG, DEFAULT_NAVIGATION, DEFAULT_HERO_BUTTONS, ALL_SETTINGS_SECTION_IDS, BUILTIN_HOMEPAGE_SECTION_IDS } from './settings/types';
import { useSettingsSensors } from './settings/useSettingsSensors';
import { useHomepagePages } from './settings/useHomepagePages';
import { BasicInfoSection } from './settings/BasicInfoSection';
import { StylingSection } from './settings/StylingSection';
import { HeroSection } from './settings/HeroSection';
import { ContentDisplaySection } from './settings/ContentDisplaySection';
import { NavigationSection } from './settings/NavigationSection';
import { HomepageLayoutSection } from './settings/HomepageLayoutSection';
import { SettingsPresets, type Preset } from './settings/SettingsPresets';
import { HomepagePreviewDialog } from './settings/HomepagePreviewDialog';

export default function AdminSettings() {
  const { config, updateConfig } = useAppContext();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { isAdmin, isMaster: isMasterUser, isLoading: authLoading, masterPubkey } = useAdminAuth(user?.pubkey);

  // Fetch kind 34128 pages flagged as homepage sections.
  const { data: homepagePages = [] } = useHomepagePages({
    staleTime: 30000,
    adminRoles: config.siteConfig?.adminRoles,
  });

  const [navigation, setNavigation] = useState<NavigationItem[]>(() =>
    config.navigation ?? DEFAULT_NAVIGATION
  );

  const [siteConfig, setSiteConfig] = useState<SiteConfig>(() => ({
    ...DEFAULT_SITE_CONFIG,
    ...config.siteConfig,
    defaultRelay: config.siteConfig?.defaultRelay ?? getDefaultRelayUrl(),
    publishRelays: config.siteConfig?.publishRelays ?? [
      getDefaultRelayUrl(),
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nos.lol'
    ].filter(Boolean),
    heroButtons: config.siteConfig?.heroButtons ?? DEFAULT_HERO_BUTTONS,
    sectionOrder: config.siteConfig?.sectionOrder ?? [...ALL_SETTINGS_SECTION_IDS],
    homepageSectionOrder: config.siteConfig?.homepageSectionOrder?.length ? config.siteConfig.homepageSectionOrder : [...BUILTIN_HOMEPAGE_SECTION_IDS],
  }));

  // Stable callback for section components to update siteConfig fields
  const updateSiteConfig = useCallback((updates: Partial<SiteConfig>) => {
    setSiteConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Reconcile homepageSectionOrder: when homepage pages are fetched, append any
  // new page section IDs that aren't yet in the order. Runs only when the set
  // of homepage page paths actually changes (not on every re-render).
  const homepagePagePaths = useMemo(
    () => homepagePages.map(p => p.path).sort().join(','),
    [homepagePages]
  );
  useEffect(() => {
    const pageIds = homepagePages.map(p => `page:${p.path}`);
    setSiteConfig(prev => {
      const order = prev.homepageSectionOrder ?? [...BUILTIN_HOMEPAGE_SECTION_IDS];
      const newIds = pageIds.filter(id => !order.includes(id));
      if (newIds.length === 0) return prev; // no change — avoid unnecessary re-render
      return { ...prev, homepageSectionOrder: [...order, ...newIds] };
    });
  }, [homepagePagePaths]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only depend on the serialized paths string

  // Per-section dirty checks — each only recomputes when its own fields change
  const dirtyBasic = useMemo(() => {
    const o = config.siteConfig || {};
    return siteConfig.title !== (o.title ?? DEFAULT_SITE_CONFIG.title) ||
      siteConfig.logo !== (o.logo ?? DEFAULT_SITE_CONFIG.logo) ||
      siteConfig.favicon !== (o.favicon ?? DEFAULT_SITE_CONFIG.favicon) ||
      siteConfig.ogImage !== (o.ogImage ?? DEFAULT_SITE_CONFIG.ogImage) ||
      siteConfig.nip19Gateway !== (o.nip19Gateway ?? DEFAULT_SITE_CONFIG.nip19Gateway);
  }, [siteConfig.title, siteConfig.logo, siteConfig.favicon, siteConfig.ogImage, siteConfig.nip19Gateway, config.siteConfig]);

  const dirtyStyling = useMemo(() => {
    const o = config.siteConfig || {};
    return siteConfig.tweakcnThemeUrl !== (o.tweakcnThemeUrl ?? DEFAULT_SITE_CONFIG.tweakcnThemeUrl);
  }, [siteConfig.tweakcnThemeUrl, config.siteConfig]);

  const dirtyHero = useMemo(() => {
    const o = config.siteConfig || {};
    return siteConfig.heroTitle !== (o.heroTitle ?? DEFAULT_SITE_CONFIG.heroTitle) ||
      siteConfig.heroSubtitle !== (o.heroSubtitle ?? DEFAULT_SITE_CONFIG.heroSubtitle) ||
      siteConfig.heroBackground !== (o.heroBackground ?? DEFAULT_SITE_CONFIG.heroBackground) ||
      siteConfig.heroBackgroundType !== (o.heroBackgroundType ?? DEFAULT_SITE_CONFIG.heroBackgroundType) ||
      siteConfig.heroBackgroundColor !== (o.heroBackgroundColor ?? DEFAULT_SITE_CONFIG.heroBackgroundColor) ||
      siteConfig.heroTextColor !== (o.heroTextColor ?? DEFAULT_SITE_CONFIG.heroTextColor) ||
      siteConfig.heroBanner !== (o.heroBanner ?? DEFAULT_SITE_CONFIG.heroBanner);
  }, [siteConfig.heroTitle, siteConfig.heroSubtitle, siteConfig.heroBackground, siteConfig.heroBackgroundType, siteConfig.heroBackgroundColor, siteConfig.heroTextColor, siteConfig.heroBanner, config.siteConfig]);

  const dirtyContent = useMemo(() => {
    const o = config.siteConfig || {};
    return siteConfig.showEvents !== (o.showEvents ?? DEFAULT_SITE_CONFIG.showEvents) ||
      siteConfig.showBlog !== (o.showBlog ?? DEFAULT_SITE_CONFIG.showBlog) ||
      siteConfig.showFeed !== (o.showFeed ?? DEFAULT_SITE_CONFIG.showFeed) ||
      siteConfig.maxEvents !== (o.maxEvents ?? DEFAULT_SITE_CONFIG.maxEvents) ||
      siteConfig.maxBlogPosts !== (o.maxBlogPosts ?? DEFAULT_SITE_CONFIG.maxBlogPosts) ||
      siteConfig.maxFeedNotes !== (o.maxFeedNotes ?? DEFAULT_SITE_CONFIG.maxFeedNotes) ||
      JSON.stringify(siteConfig.heroButtons) !== JSON.stringify(o.heroButtons ?? DEFAULT_HERO_BUTTONS);
  }, [siteConfig.showEvents, siteConfig.showBlog, siteConfig.showFeed, siteConfig.maxEvents, siteConfig.maxBlogPosts, siteConfig.maxFeedNotes, siteConfig.heroButtons, config.siteConfig]);

  const dirtyNavigation = useMemo(() => {
    return JSON.stringify(navigation) !== JSON.stringify(config.navigation ?? DEFAULT_NAVIGATION);
  }, [navigation, config.navigation]);

  const dirtyHomepage = useMemo(() => {
    const o = config.siteConfig || {};
    return JSON.stringify(siteConfig.homepageSectionOrder) !== JSON.stringify(o.homepageSectionOrder ?? [...BUILTIN_HOMEPAGE_SECTION_IDS]);
  }, [siteConfig.homepageSectionOrder, config.siteConfig]);

  const isDirty = dirtyBasic || dirtyStyling || dirtyHero || dirtyContent || dirtyNavigation || dirtyHomepage;

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Apply TweakCN theme live — themes are applied instantly when selected,
  // and saved permanently when the user clicks Save Changes.
  useEffect(() => {
    const themeUrl = siteConfig.tweakcnThemeUrl;
    if (!themeUrl) {
      document.getElementById('tweakcn-theme')?.remove();
      return;
    }

    const fetchTheme = async () => {
      try {
        const response = await fetch(themeUrl);
        if (!response.ok) throw new Error(`Failed to fetch theme: ${response.statusText}`);
        const themeData = await response.json();
        const vars = themeData.cssVars || themeData;

        let cssVars = '';
        const formatVars = (entries: Record<string, string>) => {
          return Object.entries(entries)
            .map(([k, v]) => {
              const varName = k === 'sidebar' ? 'sidebar-background' : k;
              return `--${varName}: ${v};`;
            })
            .join(' ');
        };

        if (vars.light) cssVars += `:root { ${formatVars(vars.light)} }\n`;
        if (vars.dark) cssVars += `.dark { ${formatVars(vars.dark)} }\n`;
        if (vars.theme) cssVars += `:root { ${formatVars(vars.theme)} }\n`;
        if (!vars.light && !vars.dark && !vars.theme) {
          cssVars += `:root { ${formatVars(vars)} }`;
        }

        let styleTag = document.getElementById('tweakcn-theme') as HTMLStyleElement;
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = 'tweakcn-theme';
          document.head.appendChild(styleTag);
        }
        styleTag.textContent = cssVars;
      } catch (error) {
        console.error('Error applying theme:', error);
      }
    };

    fetchTheme();
  }, [siteConfig.tweakcnThemeUrl]);

  // Sync state with config when it changes (e.g. after loading from localStorage or Relay)
  useEffect(() => {
    if (isSaving || isRefreshing) {
      return;
    }

    if (config.siteConfig) {
      setSiteConfig(prev => ({
        ...prev,
        ...config.siteConfig,
        publishRelays: config.siteConfig?.publishRelays ?? prev.publishRelays,
        adminRoles: config.siteConfig?.adminRoles ?? prev.adminRoles,
      }) as SiteConfig);
    }
    if (config.navigation) {
      setNavigation(config.navigation);
    }
  }, [config.siteConfig, config.navigation, isSaving, isRefreshing]);

  const sensors = useSettingsSensors();

  const handleSectionDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSiteConfig((prev) => {
        const saved = prev.sectionOrder || ALL_SETTINGS_SECTION_IDS;
        const known = new Set(ALL_SETTINGS_SECTION_IDS);
        const present = new Set(saved);
        const order = [...saved.filter(id => known.has(id)), ...ALL_SETTINGS_SECTION_IDS.filter(id => !present.has(id))];
        const oldIndex = order.indexOf(active.id as string);
        const newIndex = order.indexOf(over.id as string);
        return {
          ...prev,
          sectionOrder: arrayMove(order, oldIndex, newIndex),
        };
      });
    }
  }, []);

  const handleApplyPreset = useCallback((preset: Preset) => {
    if (preset.siteConfig) {
      setSiteConfig(prev => ({ ...prev, ...preset.siteConfig }));
    }
    if (preset.navigation) {
      setNavigation(preset.navigation);
    }
    toast({
      title: "Template Applied",
      description: `${preset.name} template loaded. Review and save to persist.`,
    });
  }, [toast]);

  // Reconcile sectionOrder: ensure all built-in sections are present.
  // Older saved configs may not include 'homepage' (added after initial release).
  const sectionOrder = useMemo(() => {
    const saved = siteConfig.sectionOrder || ALL_SETTINGS_SECTION_IDS;
    const known = new Set(ALL_SETTINGS_SECTION_IDS);
    const present = new Set(saved);
    return [...saved.filter(id => known.has(id)), ...ALL_SETTINGS_SECTION_IDS.filter(id => !present.has(id))];
  }, [siteConfig.sectionOrder]);

  // Reconcile homepageSectionOrder for display: filter out stale page IDs
  // (pages that no longer exist) while keeping the saved order.
  const homepagePageIds = useMemo(
    () => new Set(homepagePages.map(p => `page:${p.path}`)),
    [homepagePages]
  );
  const reconciledHomepageOrder = useMemo(() => {
    const order = siteConfig.homepageSectionOrder ?? [...BUILTIN_HOMEPAGE_SECTION_IDS];
    const builtinIds = new Set(BUILTIN_HOMEPAGE_SECTION_IDS);
    return order.filter(id => builtinIds.has(id) || homepagePageIds.has(id));
  }, [siteConfig.homepageSectionOrder, homepagePageIds]);

  const disabled = !isMasterUser;

  const canView = isMasterUser || (isAdmin && (siteConfig.readOnlyAdminAccess || config.siteConfig?.readOnlyAdminAccess));

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Checking authorization...</p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground">
          Only the Master User can access site settings.
        </p>
      </div>
    );
  }

  // Load existing site configuration from NIP-78 kind 30078
  const handleLoadConfig = async () => {
    setIsRefreshing(true);

    try {
      if (!masterPubkey) {
        throw new Error('Master pubkey is not available');
      }
      const signal = AbortSignal.timeout(5000);
      const scopedDTag = getSiteConfigDTag();
      const events = await nostr.query([
        {
          kinds: [30078],
          authors: [masterPubkey],
          '#d': [scopedDTag],
          limit: 1
        }
      ], { signal });

      if (events.length > 0) {
        const event = events[0];
        const loadedConfig: Partial<SiteConfig> = {};

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
          tweakcnThemeUrl: 'tweakcn_theme_url',
          nip19Gateway: 'nip19_gateway',
          sectionOrder: 'section_order',
          readOnlyAdminAccess: 'read_only_admin_access'
        };

        const eventTags = event.tags || [];

        Object.entries(tags).forEach(([key, tagName]) => {
          const val = eventTags.find(([name]) => name === tagName)?.[1];
          if (val !== undefined) {
            (loadedConfig as Record<string, string | boolean | number | string[] | Record<string, string> | undefined>)[key] = val;
          }
        });

        const updatedAtTag = eventTags.find(([name]) => name === 'updated_at')?.[1];
        const eventUpdatedAt = updatedAtTag ? parseInt(updatedAtTag) : event.created_at;
        loadedConfig.updatedAt = eventUpdatedAt;

        const showEvents = eventTags.find(([name]) => name === 'show_events')?.[1];
        if (showEvents !== undefined) loadedConfig.showEvents = showEvents === 'true';

        const showBlog = eventTags.find(([name]) => name === 'show_blog')?.[1];
        if (showBlog !== undefined) loadedConfig.showBlog = showBlog === 'true';

        const showFeed = eventTags.find(([name]) => name === 'show_feed')?.[1];
        if (showFeed !== undefined) loadedConfig.showFeed = showFeed === 'true';

        const readOnlyAdminAccess = eventTags.find(([name]) => name === 'read_only_admin_access')?.[1];
        if (readOnlyAdminAccess !== undefined) loadedConfig.readOnlyAdminAccess = readOnlyAdminAccess === 'true';

        const autoHarvest24h = eventTags.find(([name]) => name === 'auto_harvest_24h')?.[1];
        if (autoHarvest24h !== undefined) loadedConfig.autoHarvest24h = autoHarvest24h === 'true';

        const maxEvents = eventTags.find(([name]) => name === 'max_events')?.[1];
        if (maxEvents !== undefined) loadedConfig.maxEvents = parseInt(maxEvents);

        const maxBlogPosts = eventTags.find(([name]) => name === 'max_blog_posts')?.[1];
        if (maxBlogPosts !== undefined) loadedConfig.maxBlogPosts = parseInt(maxBlogPosts);

        const maxFeedNotes = eventTags.find(([name]) => name === 'max_feed_notes')?.[1];
        if (maxFeedNotes !== undefined) loadedConfig.maxFeedNotes = parseInt(maxFeedNotes);

        const relaysTag = eventTags.find(([name]) => name === 'publish_relays')?.[1];
        if (relaysTag) {
          try {
            const parsed = JSON.parse(relaysTag);
            if (Array.isArray(parsed)) loadedConfig.publishRelays = parsed;
          } catch (e) {
            console.error('Failed to parse publish_relays tag', e);
          }
        }

        const adminRolesTag = eventTags.find(([name]) => name === 'admin_roles')?.[1];
        if (adminRolesTag) {
          try {
            const parsed = JSON.parse(adminRolesTag);
            if (parsed && typeof parsed === 'object') {
              const migrated: Record<string, 'publisher' | 'user'> = {};
              for (const [pk, role] of Object.entries(parsed)) {
                if (role === 'primary') migrated[pk] = 'publisher';
                else if (role === 'secondary') migrated[pk] = 'user';
                else migrated[pk] = role as 'publisher' | 'user';
              }
              loadedConfig.adminRoles = migrated;
            }
          } catch (e) {
            console.error('Failed to parse admin_roles tag', e);
          }
        }

        const sectionOrderTag = eventTags.find(([name]) => name === 'section_order')?.[1];
        if (sectionOrderTag) {
          try {
            const parsed = JSON.parse(sectionOrderTag);
            if (Array.isArray(parsed)) loadedConfig.sectionOrder = parsed;
          } catch (e) {
            console.error('Failed to parse section_order tag', e);
          }
        }

        const homepageSectionOrderTag = eventTags.find(([name]) => name === 'homepage_section_order')?.[1];
        if (homepageSectionOrderTag) {
          try {
            const parsed = JSON.parse(homepageSectionOrderTag);
            if (Array.isArray(parsed) && parsed.length > 0) loadedConfig.homepageSectionOrder = parsed;
          } catch (e) {
            console.error('Failed to parse homepage_section_order tag', e);
          }
        }

        const envDefaultRelay = getDefaultRelayUrl();
        const relayFromEvent = loadedConfig.defaultRelay as string | undefined;

        if (envDefaultRelay && relayFromEvent && envDefaultRelay !== relayFromEvent) {
          loadedConfig.defaultRelay = envDefaultRelay;
        }

        const feedNpubsTag = eventTags.find(([name]) => name === 'feed_npubs')?.[1];
        if (feedNpubsTag) {
          try {
            const parsed = JSON.parse(feedNpubsTag);
            if (Array.isArray(parsed)) loadedConfig.feedNpubs = parsed;
          } catch (e) {
            console.error('Failed to parse feed_npubs tag', e);
          }
        }

        const blogNpubsTag = eventTags.find(([name]) => name === 'blog_npubs')?.[1];
        if (blogNpubsTag) {
          try {
            const parsed = JSON.parse(blogNpubsTag);
            if (Array.isArray(parsed)) loadedConfig.blogNpubs = parsed;
          } catch (e) {
            console.error('Failed to parse blog_npubs tag', e);
          }
        }

        const feedReadFromPublishRelays = eventTags.find(([name]) => name === 'feed_read_from_publish_relays')?.[1];
        if (feedReadFromPublishRelays !== undefined) loadedConfig.feedReadFromPublishRelays = feedReadFromPublishRelays === 'true';

        const heroButtonsTag = eventTags.find(([name]) => name === 'hero_buttons')?.[1];
        if (heroButtonsTag) {
          try {
            const parsed = JSON.parse(heroButtonsTag);
            if (Array.isArray(parsed)) loadedConfig.heroButtons = parsed;
          } catch (e) {
            console.error('Failed to parse hero_buttons tag', e);
          }
        }

        let loadedNavigation: NavigationItem[] = [];
        try {
          const parsedContent = JSON.parse(event.content);
          if (Array.isArray(parsedContent)) {
            loadedNavigation = parsedContent;
          } else if (parsedContent && typeof parsedContent === 'object' && Array.isArray(parsedContent.navigation)) {
            loadedNavigation = parsedContent.navigation;
          }
        } catch {
          // Use default navigation
        }

        setSiteConfig(prev => ({
          ...prev,
          ...loadedConfig
        }) as SiteConfig);
        setNavigation(loadedNavigation);

        updateConfig((currentConfig) => ({
          ...currentConfig,
          siteConfig: {
            ...(currentConfig.siteConfig || {}),
            ...loadedConfig,
            updatedAt: eventUpdatedAt,
          },
          navigation: loadedNavigation,
        }));

        queryClient.clear();
      }
    } catch (error) {
      console.error('Failed to load existing config:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    const filteredRelays = siteConfig.publishRelays.filter(r => r.trim() !== '');

    try {
      // Merge this page's local state over the context config so the
      // replaceable event keeps tags managed by other admin pages.
      const configTags = buildSiteConfigTags({ ...config.siteConfig, ...siteConfig });

      await publishEvent({
        event: {
          kind: 30078,
          content: JSON.stringify({ navigation }),
          tags: configTags,
        }
      });

      updateConfig((currentConfig) => ({
        ...currentConfig,
        siteConfig: {
          ...(currentConfig.siteConfig || {}),
          ...siteConfig,
          publishRelays: filteredRelays,
          updatedAt: Math.floor(Date.now() / 1000),
        },
        navigation,
      }));

      queryClient.clear();
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Site Settings</h2>
          <p className="text-muted-foreground">
            Configure your site appearance and navigation.
          </p>
        </div>
        <div className="flex justify-between items-center gap-2">
          <SettingsPresets
            onApply={handleApplyPreset}
            disabled={disabled}
            hasUnsavedChanges={isDirty}
          />
          <Button variant="outline" size="sm" onClick={handleLoadConfig} disabled={isRefreshing || !user || !isMasterUser} className="shrink-0">
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {siteConfig.readOnlyAdminAccess && !isMasterUser && (
        <div className="flex items-center gap-2 p-4 border rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-bold">Read Only Mode:</span> You are viewing these settings in demo mode. Changes cannot be saved.
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext
          items={sectionOrder}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-6">
            {sectionOrder.map((sectionId) => {
              switch (sectionId) {
                case 'basic':
                  return (
                    <BasicInfoSection
                      key="basic"
                      title={siteConfig.title}
                      logo={siteConfig.logo}
                      favicon={siteConfig.favicon}
                      ogImage={siteConfig.ogImage}
                      nip19Gateway={siteConfig.nip19Gateway || 'https://nostr.at'}
                      onChange={updateSiteConfig}
                      disabled={disabled}
                      isDirty={dirtyBasic}
                    />
                  );
                case 'styling':
                  return (
                    <StylingSection
                      key="styling"
                      tweakcnThemeUrl={siteConfig.tweakcnThemeUrl || ''}
                      onChange={updateSiteConfig}
                      disabled={disabled}
                      isDirty={dirtyStyling}
                    />
                  );
                case 'hero':
                  return (
                    <HeroSection
                      key="hero"
                      heroBanner={siteConfig.heroBanner}
                      heroTitle={siteConfig.heroTitle}
                      heroSubtitle={siteConfig.heroSubtitle}
                      heroBackgroundType={siteConfig.heroBackgroundType}
                      heroBackground={siteConfig.heroBackground}
                      heroBackgroundColor={siteConfig.heroBackgroundColor}
                      heroTextColor={siteConfig.heroTextColor}
                      onChange={updateSiteConfig}
                      disabled={disabled}
                      isDirty={dirtyHero}
                    />
                  );
                case 'content':
                  return (
                    <ContentDisplaySection
                      key="content"
                      showEvents={siteConfig.showEvents}
                      showBlog={siteConfig.showBlog}
                      showFeed={siteConfig.showFeed}
                      maxEvents={siteConfig.maxEvents}
                      maxBlogPosts={siteConfig.maxBlogPosts}
                      maxFeedNotes={siteConfig.maxFeedNotes}
                      heroButtons={siteConfig.heroButtons}
                      onChange={updateSiteConfig}
                      disabled={disabled}
                      isDirty={dirtyContent}
                    />
                  );
                case 'navigation':
                  return (
                    <NavigationSection
                      key="navigation"
                      navigation={navigation}
                      onNavigationChange={setNavigation}
                      disabled={disabled}
                      isDirty={dirtyNavigation}
                    />
                  );
                case 'homepage':
                  return (
                    <HomepageLayoutSection
                      key="homepage"
                      homepageSectionOrder={reconciledHomepageOrder}
                      homepagePages={homepagePages}
                      onChange={updateSiteConfig}
                      disabled={disabled}
                      isDirty={dirtyHomepage}
                    />
                  );
                default:
                  return null;
              }
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Sticky save bar — visible only when there are unsaved changes */}
      {isDirty && isMasterUser && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background shadow-lg">
          <div className="mx-auto max-w-4xl flex items-center justify-between gap-2 px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <span className="text-sm text-muted-foreground flex items-center gap-2 shrink-0">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              <span className="hidden sm:inline">Unsaved changes</span>
              <span className="sm:hidden text-xs">Unsaved</span>
            </span>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                disabled={isSaving}
                className="shrink-0"
              >
                <Eye className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Preview</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadConfig}
                disabled={isRefreshing || isSaving}
                className="shrink-0"
              >
                <RotateCcw className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Discard</span>
              </Button>
              <Button
                size="sm"
                onClick={handleSaveConfig}
                disabled={isSaving}
                className="shrink-0"
              >
                <Save className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save Changes'}</span>
                <span className="sm:hidden">{isSaving ? '...' : 'Save'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Live homepage preview dialog */}
      <HomepagePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        siteConfig={siteConfig}
        navigation={navigation}
      />
    </div>
  );
}
