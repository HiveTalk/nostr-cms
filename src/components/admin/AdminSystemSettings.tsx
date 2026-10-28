import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Save, Plus, Trash2, RefreshCw, User, Shield, ShieldAlert, CheckCircle2, AlertTriangle, RotateCcw, ExternalLink } from 'lucide-react';
import { useNostrJsonUsers, dedupeUsersByPubkey } from '@/hooks/useNostrJsonUsers';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuthor } from '@/hooks/useAuthor';
import { useAdminAuth } from '@/hooks/useRemoteNostrJson';
import { getDefaultRelayUrl, getSiteConfigDTag } from '@/lib/relay';
import { buildSiteConfigTags } from '@/lib/siteConfig';
import { BUILTIN_HOMEPAGE_SECTION_IDS } from '@/components/admin/settings/types';
import { AiSettingsSection } from '@/components/admin/settings/AiSettingsSection';

interface SiteConfig {
  title: string;
  logo: string;
  favicon: string;
  ogImage: string;
  heroTitle: string;
  heroSubtitle: string;
  heroBackground: string;
  showEvents: boolean;
  showBlog: boolean;
  maxEvents: number;
  maxBlogPosts: number;
  defaultRelay: string;
  publishRelays: string[];
  blossomRelays: string[];
  adminRoles: Record<string, 'publisher' | 'user'>;
  tweakcnThemeUrl?: string;
  feedNpubs: string[];
  blogNpubs: string[];
  feedReadFromPublishRelays: boolean;
  sectionOrder?: string[];
  readOnlyAdminAccess: boolean;
  autoHarvest24h?: boolean;
  aiHelperAccess?: 'master' | 'admins';
  updatedAt?: number;
}

function UserRoleManager({
  pubkey,
  name,
  role,
  isMasterOfSession,
  isThisUserMaster,
  onRoleChange
}: {
  pubkey: string;
  name: string;
  role?: 'publisher' | 'user';
  isMasterOfSession: boolean;
  isThisUserMaster: boolean;
  onRoleChange: (role: 'publisher' | 'user') => void;
}) {
  const { data: authorData } = useAuthor(pubkey);
  const metadata = authorData?.metadata;

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg bg-card">
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarImage src={metadata?.picture} alt={name} />
          <AvatarFallback><User className="h-4 w-4" /></AvatarFallback>
        </Avatar>
        <div>
          <div className="font-medium flex items-center gap-2">
            {name}
            {isThisUserMaster && <Badge variant="default" className="bg-purple-600 hover:bg-purple-700">Master User</Badge>}
            {!isThisUserMaster && role === 'publisher' && <Badge variant="default" className="bg-green-600 hover:bg-green-700">Publisher</Badge>}
            {!isThisUserMaster && role === 'user' && <Badge variant="default" className="bg-blue-600 hover:bg-blue-700">User</Badge>}
            {!isThisUserMaster && !role && <Badge variant="outline" className="text-muted-foreground">Unassigned</Badge>}
          </div>
          <div className="text-xs text-muted-foreground font-mono">{pubkey.slice(0, 8)}...{pubkey.slice(-8)}</div>
        </div>
      </div>

      {isThisUserMaster ? (
        <div className="flex items-center gap-2 text-sm font-medium text-purple-600 px-3">
          <Shield className="h-4 w-4" />
          Primary Access (Owner)
        </div>
      ) : isMasterOfSession && (
        <Select
          value={role || 'user'}
          onValueChange={(val) => onRoleChange(val as 'publisher' | 'user')}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="publisher">Publisher</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default function AdminSystemSettings() {
  const { config, updateConfig } = useAppContext();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isAdmin, isMaster: isMasterUser, isLoading: authLoading, masterPubkey } = useAdminAuth(user?.pubkey);

  const [siteConfig, setSiteConfig] = useState<SiteConfig>(() => ({
    title: config.siteConfig?.title ?? 'My Meetup Site',
    logo: config.siteConfig?.logo ?? '',
    favicon: config.siteConfig?.favicon ?? '',
    ogImage: config.siteConfig?.ogImage ?? '',
    heroTitle: config.siteConfig?.heroTitle ?? 'Welcome to Our Community',
    heroSubtitle: config.siteConfig?.heroSubtitle ?? 'Join us for amazing meetups and events',
    heroBackground: config.siteConfig?.heroBackground ?? 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&h=1080&fit=crop',
    showEvents: config.siteConfig?.showEvents ?? true,
    showBlog: config.siteConfig?.showBlog ?? true,
    maxEvents: config.siteConfig?.maxEvents ?? 6,
    maxBlogPosts: config.siteConfig?.maxBlogPosts ?? 3,
    defaultRelay: config.siteConfig?.defaultRelay ?? getDefaultRelayUrl(),
    publishRelays: config.siteConfig?.publishRelays ?? [
      getDefaultRelayUrl(),
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nos.lol'
    ].filter(Boolean),
    blossomRelays: config.siteConfig?.blossomRelays ?? [
      'https://blossom.primal.net',
      'https://blossom.band'
    ],
    adminRoles: config.siteConfig?.adminRoles ?? {},
    feedNpubs: config.siteConfig?.feedNpubs ?? [],
    blogNpubs: config.siteConfig?.blogNpubs ?? [],
    feedReadFromPublishRelays: config.siteConfig?.feedReadFromPublishRelays ?? false,
    sectionOrder: config.siteConfig?.sectionOrder ?? ['navigation', 'basic', 'styling', 'hero', 'content', 'feed'],
    readOnlyAdminAccess: config.siteConfig?.readOnlyAdminAccess ?? false,
    autoHarvest24h: config.siteConfig?.autoHarvest24h ?? false,
  }));

  const { data: nostrJsonData, isLoading: isLoadingUsers } = useNostrJsonUsers();
  const dedupedNostrEntries = useMemo(() => {
    if (!nostrJsonData?.users) return [] as Array<[string, string]>;
    const deduped = dedupeUsersByPubkey(nostrJsonData.users);
    return deduped.map(u => [u.name, u.pubkey] as [string, string]);
  }, [nostrJsonData]);

  useEffect(() => {
    if (isSaving || isRefreshing) return;

    if (config.siteConfig) {
      setSiteConfig(prev => ({
        ...prev,
        ...config.siteConfig,
        publishRelays: config.siteConfig?.publishRelays ?? prev.publishRelays,
        adminRoles: config.siteConfig?.adminRoles ?? prev.adminRoles,
        feedNpubs: config.siteConfig?.feedNpubs ?? prev.feedNpubs,
        blogNpubs: config.siteConfig?.blogNpubs ?? prev.blogNpubs,
        feedReadFromPublishRelays: config.siteConfig?.feedReadFromPublishRelays ?? prev.feedReadFromPublishRelays,
        sectionOrder: config.siteConfig?.sectionOrder ?? prev.sectionOrder,
      }) as SiteConfig);
    }
  }, [config.siteConfig, isSaving, isRefreshing, isMasterUser]);

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
          Only the Master User can access admin settings.
        </p>
      </div>
    );
  }

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
          defaultRelay: 'default_relay',
          tweakcnThemeUrl: 'tweakcn_theme_url',
          blossomRelays: 'blossom_relays',
          readOnlyAdminAccess: 'read_only_admin_access'
        };

        const eventTags = event.tags || [];

        Object.entries(tags).forEach(([key, tagName]) => {
          const val = eventTags.find(([name]) => name === tagName)?.[1];
          if (val !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (loadedConfig as any)[key] = val;
          }
        });

        const updatedAtTag = eventTags.find(([name]) => name === 'updated_at')?.[1];
        const eventUpdatedAt = updatedAtTag ? parseInt(updatedAtTag) : event.created_at;
        loadedConfig.updatedAt = eventUpdatedAt;

        const showEvents = eventTags.find(([name]) => name === 'show_events')?.[1];
        if (showEvents !== undefined) loadedConfig.showEvents = showEvents === 'true';

        const showBlog = eventTags.find(([name]) => name === 'show_blog')?.[1];
        if (showBlog !== undefined) loadedConfig.showBlog = showBlog === 'true';

        const readOnlyAdminAccess = eventTags.find(([name]) => name === 'read_only_admin_access')?.[1];
        if (readOnlyAdminAccess !== undefined) loadedConfig.readOnlyAdminAccess = readOnlyAdminAccess === 'true';

        const autoHarvest24h = eventTags.find(([name]) => name === 'auto_harvest_24h')?.[1];
        if (autoHarvest24h !== undefined) loadedConfig.autoHarvest24h = autoHarvest24h === 'true';

        const aiHelperAccess = eventTags.find(([name]) => name === 'ai_helper_access')?.[1];
        if (aiHelperAccess === 'master' || aiHelperAccess === 'admins') loadedConfig.aiHelperAccess = aiHelperAccess;

        const maxEvents = eventTags.find(([name]) => name === 'max_events')?.[1];
        if (maxEvents !== undefined) loadedConfig.maxEvents = parseInt(maxEvents);

        const maxBlogPosts = eventTags.find(([name]) => name === 'max_blog_posts')?.[1];
        if (maxBlogPosts !== undefined) loadedConfig.maxBlogPosts = parseInt(maxBlogPosts);

        const feedNpubsTag = eventTags.find(([name]) => name === 'feed_npubs')?.[1];
        if (feedNpubsTag) {
          try {
            const parsed = JSON.parse(feedNpubsTag);
            if (Array.isArray(parsed)) loadedConfig.feedNpubs = parsed as string[];
          } catch (e) {
            console.error('Failed to parse feed_npubs tag', e);
          }
        }

        const blogNpubsTag = eventTags.find(([name]) => name === 'blog_npubs')?.[1];
        if (blogNpubsTag) {
          try {
            const parsed = JSON.parse(blogNpubsTag);
            if (Array.isArray(parsed)) loadedConfig.blogNpubs = parsed as string[];
          } catch (e) {
            console.error('Failed to parse blog_npubs tag', e);
          }
        }

        const feedReadTag = eventTags.find(([name]) => name === 'feed_read_from_publish_relays')?.[1];
        if (feedReadTag !== undefined) loadedConfig.feedReadFromPublishRelays = feedReadTag === 'true';

        const sectionOrderTag = eventTags.find(([name]) => name === 'section_order')?.[1];
        if (sectionOrderTag) {
          try {
            const parsed = JSON.parse(sectionOrderTag);
            if (Array.isArray(parsed)) loadedConfig.sectionOrder = parsed as string[];
          } catch (e) {
            console.error('Failed to parse section_order tag', e);
          }
        }

        const relaysTag = eventTags.find(([name]) => name === 'publish_relays')?.[1];
        if (relaysTag) {
          try {
            const parsed = JSON.parse(relaysTag);
            if (Array.isArray(parsed)) loadedConfig.publishRelays = parsed;
          } catch (e) {
            console.error('Failed to parse publish_relays tag', e);
          }
        }

        const blossomRelaysTag = eventTags.find(([name]) => name === 'blossom_relays')?.[1];
        if (blossomRelaysTag) {
          try {
            const parsed = JSON.parse(blossomRelaysTag);
            if (Array.isArray(parsed)) loadedConfig.blossomRelays = parsed;
          } catch (e) {
            console.error('Failed to parse blossom_relays tag', e);
          }
        }

        const adminRolesTag = eventTags.find(([name]) => name === 'admin_roles')?.[1];
        if (adminRolesTag) {
          try {
            const parsed = JSON.parse(adminRolesTag);
            if (parsed && typeof parsed === 'object') loadedConfig.adminRoles = parsed;
          } catch (e) {
            console.error('Failed to parse admin_roles tag', e);
          }
        }

        setSiteConfig(prev => ({
          ...prev,
          ...loadedConfig
        }) as SiteConfig);

        updateConfig((currentConfig) => ({
          ...currentConfig,
          siteConfig: {
            ...(currentConfig.siteConfig || {}),
            ...loadedConfig,
            updatedAt: eventUpdatedAt,
          },
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
      // Merge fields managed elsewhere (context config) under this page's
      // local state so the replaceable event keeps every tag.
      const configTags = buildSiteConfigTags({ ...config.siteConfig, ...siteConfig });

      await publishEvent({
        event: {
          kind: 30078,
          content: JSON.stringify({ navigation: config.navigation }),
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
      }));

      queryClient.clear();
    } catch (error) {
      console.error('Failed to save config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    if (window.confirm('Are you sure you want to reset all settings to defaults? This will clear all local storage, cached data, delete relay metadata, and republish the default configuration to the relay. You will be logged out and the site will return to its original environment variable state.')) {
      try {
        // Get default values from environment variables
        const envDefaultRelay = getDefaultRelayUrl();

        // 1. Delete NIP-65 relay list (kind 10002) from the relay
        if (user) {
          try {
            await publishEvent({
              event: {
                kind: 5,
                content: "Resetting relay metadata to defaults",
                tags: [
                  ['k', '10002'],
                  ['alt', 'Delete relay list metadata']
                ]
              }
            });
          } catch (e) {
            console.error('[handleResetToDefaults] Failed to delete relay metadata:', e);
          }
        }

        // 2. Publish Kind 30078 with default values (blanked out except for default relay)
        const scopedDTag = getSiteConfigDTag();
        const defaultConfigTags = [
          ['d', scopedDTag],
          ['title', 'My Meetup Site'],
          ['logo', ''],
          ['favicon', ''],
          ['og_image', ''],
          ['hero_title', 'Welcome to Our Community'],
          ['hero_subtitle', 'Join us for amazing meetups and events'],
          ['hero_background', 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&h=1080&fit=crop'],
          ['hero_background_type', ''],
          ['hero_background_color', ''],
          ['hero_text_color', ''],
          ['hero_banner', ''],
          ['hero_buttons', JSON.stringify([])],
          ['show_events', 'true'],
          ['show_blog', 'true'],
          ['show_feed', 'false'],
          ['max_events', '6'],
          ['max_blog_posts', '3'],
          ['max_feed_notes', '20'],
          ['default_relay', envDefaultRelay],
          ['publish_relays', JSON.stringify([envDefaultRelay])],
          ['blossom_relays', JSON.stringify(['https://blossom.primal.net', 'https://blossom.band'])],
          ['admin_roles', JSON.stringify({})],
          ['feed_npubs', JSON.stringify([])],
          ['feed_read_from_publish_relays', 'false'],
          ['tweakcn_theme_url', ''],
          ['nip19_gateway', 'https://nostr.at'],
          ['section_order', JSON.stringify(['navigation', 'basic', 'styling', 'hero', 'content', 'feed'])],
          ['homepage_section_order', JSON.stringify([...BUILTIN_HOMEPAGE_SECTION_IDS])],
          ['read_only_admin_access', 'false'],
          ['auto_harvest_24h', 'false'],
          ['ai_helper_access', 'master'],
          ['updated_at', Math.floor(Date.now() / 1000).toString()],
        ];

        await publishEvent({
          event: {
            kind: 30078,
            content: JSON.stringify({
              navigation: [
                { id: '2', name: 'Events', href: '/events', isSubmenu: false },
                { id: '3', name: 'Blog', href: '/blog', isSubmenu: false },
                { id: '6', name: 'Feed', href: '/feed', isSubmenu: false },
                { id: '4', name: 'About', href: '/about', isSubmenu: false },
                { id: '5', name: 'Contact', href: '/contact', isSubmenu: false },
              ]
            }),
            tags: defaultConfigTags,
          }
        });
      } catch (e) {
        console.error('[handleResetToDefaults] Failed to republish default config:', e);
      }

      // 3. Clear localStorage and cache
      localStorage.clear();
      queryClient.clear();
      window.location.href = '/';
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Admin Settings</h2>
          <p className="text-muted-foreground">
            Manage admin roles and relay configuration.
          </p>
        </div>
        <div className="flex justify-end gap-2 flex-wrap">
          <Button variant="destructive" onClick={handleResetToDefaults} disabled={!isMasterUser}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Defaults
          </Button>
          <Button variant="outline" onClick={handleLoadConfig} disabled={isRefreshing || !user || !isMasterUser}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh from Relay'}
          </Button>
          <Button onClick={handleSaveConfig} disabled={isSaving || !isMasterUser}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
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

      {/* Relay Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Relay Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="defaultRelay">Primary Relay (Default)</Label>
            <Input
              id="defaultRelay"
              value={siteConfig.defaultRelay}
              disabled
            />
            <p className="text-xs text-muted-foreground mt-1">
              This relay is used as the primary source for reading and publishing site content. Auto-detected from domain or set via <code>VITE_DEFAULT_RELAY</code>.
            </p>
            {!siteConfig.defaultRelay?.trim() && (
              <div className="flex items-center gap-2 mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-md text-sm border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>Warning: No default relay configured. The site may not be able to read content.</span>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="publishRelays">Additional Publishing Relays</Label>
            <div className="space-y-2">
              {siteConfig.publishRelays.map((relay, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={relay}
                    onChange={(e) => {
                      const newRelays = [...siteConfig.publishRelays];
                      newRelays[index] = e.target.value;
                      setSiteConfig(prev => ({ ...prev, publishRelays: newRelays }));
                    }}
                    placeholder="wss://relay.example.com"
                    disabled={!isMasterUser}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newRelays = siteConfig.publishRelays.filter((_, i) => i !== index);
                      setSiteConfig(prev => ({ ...prev, publishRelays: newRelays }));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                disabled={!isMasterUser}
                onClick={() => {
                  setSiteConfig(prev => ({
                    ...prev,
                    publishRelays: [...prev.publishRelays, '']
                  }));
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Relay
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              These relays will also receive all published content (events, blog posts, etc.) for redundancy.
            </p>
            {siteConfig.publishRelays.filter(r => r.trim() !== '').length === 0 && (
              <div className="flex items-center gap-2 mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-md text-sm border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>Warning: No publishing relays configured. Content will not be published to any relays.</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Assistant (encrypted remote key storage, master only) */}
      <AiSettingsSection isMasterUser={isMasterUser} />

      {/* Admin User Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Admin User Roles
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Manage permissions for users listed in the <b>nostr.json</b> file.
          </p>
          <p className="text-sm">
            Your current nostr.json is located at:
            <b className="break-all">
              {import.meta.env.VITE_REMOTE_NOSTR_JSON_URL || `${window.location.origin}/public/.well-known/nostr.json`}
            </b>
          </p>
          <p className="text-sm text-muted-foreground">
            {isMasterUser ? " As the master user, you can assign roles." : " View only access."}
            {" "}Learn more about <Link to="/admin/help" className="text-primary hover:underline inline-flex items-center gap-1 font-medium italic underline underline-offset-2">Admin Roles & Permissions <ExternalLink className="h-3 w-3" /></Link>
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-4 border rounded-lg bg-muted/50">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              <div className="text-sm">
                <span className="font-bold">Primary Admins:</span> Content published by these users is shown immediately on the site.
              </div>
            </div>
            <div className="flex items-center gap-2 p-4 border rounded-lg bg-muted/50">
              <CheckCircle2 className="h-5 w-5 text-blue-500" />
              <div className="text-sm">
                <span className="font-bold">Secondary Admins:</span> Content published by these users requires delegation/approval by a primary admin.
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg bg-primary/5">
            <div className="space-y-0.5">
              <Label htmlFor="demo-mode">Read-Only Admin Access (Demo Mode)</Label>
              <p className="text-xs text-muted-foreground">
                Allow all admins in <b>nostr.json</b> to view Site and Admin settings in read-only mode.
              </p>
            </div>
            <Switch
              id="demo-mode"
              disabled={!isMasterUser}
              checked={siteConfig.readOnlyAdminAccess}
              onCheckedChange={(checked) => setSiteConfig(prev => ({ ...prev, readOnlyAdminAccess: checked }))}
            />
          </div>

          <div className="grid gap-4">
            {dedupedNostrEntries.map(([name, normalizedPubkey]) => {
              const normalizedMaster = masterPubkey.toLowerCase().trim();

              return (
                <UserRoleManager
                  key={normalizedPubkey}
                  pubkey={normalizedPubkey}
                  name={name}
                  role={siteConfig.adminRoles[normalizedPubkey]}
                  isMasterOfSession={isMasterUser}
                  isThisUserMaster={normalizedPubkey === normalizedMaster}
                  onRoleChange={(role) => {
                    setSiteConfig(prev => ({
                      ...prev,
                      adminRoles: {
                        ...prev.adminRoles,
                        [normalizedPubkey]: role
                      }
                    }));
                  }}
                />
              );
            })}
            {(isLoadingUsers || !nostrJsonData?.users || nostrJsonData.users.length === 0) && (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                {isLoadingUsers ? 'Loading users...' : 'No users found in nostr.json'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
