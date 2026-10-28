export interface NavigationItem {
  id: string;
  name: string;
  href: string;
  isSubmenu: boolean;
  isLabelOnly?: boolean;
  parentId?: string;
}

export interface SiteConfig {
  title: string;
  logo: string;
  favicon: string;
  ogImage: string;
  heroTitle: string;
  heroSubtitle: string;
  heroBackground: string;
  heroBackgroundType: 'none' | 'image' | 'color';
  heroBackgroundColor: string;
  heroTextColor: string;
  heroBanner: string;
  heroButtons: Array<{
    label: string;
    href: string;
    variant?: 'default' | 'outline';
  }>;
  showEvents: boolean;
  showBlog: boolean;
  showFeed: boolean;
  feedNpubs: string[];
  blogNpubs: string[];
  feedReadFromPublishRelays: boolean;
  maxEvents: number;
  maxBlogPosts: number;
  maxFeedNotes: number;
  defaultRelay: string;
  publishRelays: string[];
  blossomRelays: string[];
  adminRoles: Record<string, 'publisher' | 'user'>;
  tweakcnThemeUrl?: string;
  sectionOrder?: string[];
  homepageSectionOrder?: string[];
  nip19Gateway?: string;
  readOnlyAdminAccess: boolean;
  autoHarvest24h?: boolean;
  /** Who may use the AI Helper: 'master' (default) or 'admins' (all nostr.json admins, via the server proxy). */
  aiHelperAccess?: 'master' | 'admins';
  updatedAt?: number;
}

export interface HomepagePage {
  id: string;
  path: string;
  content: string;
  created_at: number;
  pubkey: string;
}

// --- Shared constants ---

/** Built-in homepage section IDs in default order. */
export const BUILTIN_HOMEPAGE_SECTION_IDS: string[] = ['hero', 'events', 'blog', 'feed'];

/** Built-in settings section IDs in default order. */
export const ALL_SETTINGS_SECTION_IDS: string[] = ['navigation', 'basic', 'styling', 'hero', 'content', 'homepage'];

/** Default hero buttons (3 slots, 2 pre-filled). */
export const DEFAULT_HERO_BUTTONS: SiteConfig['heroButtons'] = [
  { label: 'View Events', href: '/events', variant: 'default' },
  { label: 'Read Blog', href: '/blog', variant: 'outline' },
  { label: '', href: '', variant: 'outline' },
];

/** Default navigation items. */
export const DEFAULT_NAVIGATION: NavigationItem[] = [
  { id: '2', name: 'Events', href: '/events', isSubmenu: false },
  { id: '3', name: 'Blog', href: '/blog', isSubmenu: false },
  { id: '6', name: 'Feed', href: '/feed', isSubmenu: false },
  { id: '4', name: 'About', href: '/about', isSubmenu: false },
  { id: '5', name: 'Contact', href: '/contact', isSubmenu: false },
];

/** Default site config values. */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  title: 'My Meetup Site',
  logo: '',
  favicon: '',
  ogImage: '',
  heroTitle: 'Welcome to Our Community',
  heroSubtitle: 'Join us for amazing meetups and events',
  heroBackground: '',
  heroBackgroundType: 'none',
  heroBackgroundColor: '#1a1a2e',
  heroTextColor: '#ffffff',
  heroBanner: '',
  heroButtons: DEFAULT_HERO_BUTTONS,
  showEvents: true,
  showBlog: true,
  showFeed: false,
  feedNpubs: [],
  blogNpubs: [],
  feedReadFromPublishRelays: false,
  maxEvents: 6,
  maxBlogPosts: 3,
  maxFeedNotes: 5,
  defaultRelay: '',
  publishRelays: [],
  blossomRelays: [],
  adminRoles: {},
  tweakcnThemeUrl: '',
  nip19Gateway: 'https://nostr.at',
  sectionOrder: [...ALL_SETTINGS_SECTION_IDS],
  homepageSectionOrder: [...BUILTIN_HOMEPAGE_SECTION_IDS],
  readOnlyAdminAccess: false,
  autoHarvest24h: false,
  aiHelperAccess: 'master',
};

/**
 * Derive a human-friendly label from a page path.
 * e.g. "/about-us" -> "About Us"
 */
export function getPageLabel(path: string): string {
  return path.replace(/^\//, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Untitled';
}

export const TWEAKCN_THEMES = [
  { name: 'Default', url: 'none' },
  { name: 'Tangerine', url: 'https://tweakcn.com/r/themes/tangerine.json' },
  { name: 'Amethyst Haze', url: 'https://tweakcn.com/r/themes/amethyst-haze.json' },
  { name: 'Midnight Bloom', url: 'https://tweakcn.com/r/themes/midnight-bloom.json' },
  { name: 'Clean Slate', url: 'https://tweakcn.com/r/themes/clean-slate.json' },
  { name: 'Bold Tech', url: 'https://tweakcn.com/r/themes/bold-tech.json' },
];
