import { getSiteConfigDTag } from '@/lib/relay';
import { BUILTIN_HOMEPAGE_SECTION_IDS, type SiteConfig } from '@/components/admin/settings/types';

/**
 * Canonical tag list for the kind 30078 site-config event. The event is
 * replaceable — every admin page that saves settings must emit the complete
 * set or fields managed by other pages are dropped on save. New config
 * fields belong here once; every save path then carries them.
 */
export function buildSiteConfigTags(c: Partial<SiteConfig> = {}): string[][] {
  return [
    ['d', getSiteConfigDTag()],
    ['title', c.title ?? ''],
    ['logo', c.logo ?? ''],
    ['favicon', c.favicon ?? ''],
    ['og_image', c.ogImage ?? ''],
    ['hero_title', c.heroTitle ?? ''],
    ['hero_subtitle', c.heroSubtitle ?? ''],
    ['hero_background', c.heroBackground ?? ''],
    ['hero_background_type', c.heroBackgroundType ?? (c.heroBackground ? 'image' : 'none')],
    ['hero_background_color', c.heroBackgroundColor ?? '#1a1a2e'],
    ['hero_text_color', c.heroTextColor ?? '#ffffff'],
    ['hero_banner', c.heroBanner ?? ''],
    ['hero_buttons', JSON.stringify(c.heroButtons ?? [])],
    ['show_events', (c.showEvents ?? true).toString()],
    ['show_blog', (c.showBlog ?? true).toString()],
    ['show_feed', (c.showFeed ?? false).toString()],
    ['max_events', (c.maxEvents ?? 6).toString()],
    ['max_blog_posts', (c.maxBlogPosts ?? 3).toString()],
    ['max_feed_notes', (c.maxFeedNotes ?? 20).toString()],
    ['default_relay', c.defaultRelay ?? ''],
    ['publish_relays', JSON.stringify((c.publishRelays ?? []).filter((r) => r.trim() !== ''))],
    ['blossom_relays', JSON.stringify(c.blossomRelays ?? [])],
    ['admin_roles', JSON.stringify(c.adminRoles ?? {})],
    ['feed_npubs', JSON.stringify(c.feedNpubs ?? [])],
    ['feed_read_from_publish_relays', (c.feedReadFromPublishRelays ?? false).toString()],
    ['blog_npubs', JSON.stringify(c.blogNpubs ?? [])],
    ['tweakcn_theme_url', c.tweakcnThemeUrl ?? ''],
    ['nip19_gateway', c.nip19Gateway ?? 'https://nostr.at'],
    ['section_order', JSON.stringify(c.sectionOrder ?? [])],
    ['homepage_section_order', JSON.stringify(c.homepageSectionOrder?.length ? c.homepageSectionOrder : [...BUILTIN_HOMEPAGE_SECTION_IDS])],
    ['read_only_admin_access', (c.readOnlyAdminAccess ?? false).toString()],
    ['auto_harvest_24h', (c.autoHarvest24h ?? false).toString()],
    ['ai_helper_access', c.aiHelperAccess ?? 'master'],
    ['updated_at', Math.floor(Date.now() / 1000).toString()],
  ];
}
