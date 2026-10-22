import { createContext } from "react";

export type Theme = "dark" | "light" | "system";

export interface RelayMetadata {
  /** List of relays with read/write permissions */
  relays: { url: string; read: boolean; write: boolean }[];
  /** Unix timestamp of when the relay list was last updated */
  updatedAt: number;
}

export interface AppConfig {
  /** Current theme */
  theme: Theme;
  /** NIP-65 relay list metadata */
  relayMetadata: RelayMetadata;
  /** Site configuration */
  siteConfig?: {
    title?: string;
    logo?: string;
    favicon?: string;
    ogImage?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    heroBackground?: string;
    heroBackgroundType?: 'none' | 'image' | 'color';
    heroBackgroundColor?: string;
    heroTextColor?: string;
    heroBanner?: string;
    heroButtons?: Array<{
      label: string;
      href: string;
      variant?: 'default' | 'outline';
    }>;
    showEvents?: boolean;
    showBlog?: boolean;
    showFeed?: boolean;
    feedNpubs?: string[];
    /** When set, only these authors' blog posts (kind 30023) appear on public pages. Empty = master + publishers. */
    blogNpubs?: string[];
    feedReadFromPublishRelays?: boolean;
    maxEvents?: number;
    maxBlogPosts?: number;
    maxFeedNotes?: number;
    /** Default relay for reading content */
    defaultRelay?: string;
    /** Publishing relays for blasting content */
    publishRelays?: string[];
    /** Admin roles mapping: pubkey -> 'publisher' | 'user' */
    adminRoles?: Record<string, 'publisher' | 'user'>;
    /** TweakCN theme URL */
    tweakcnThemeUrl?: string;
    /** Order of settings sections (admin card ordering) */
    sectionOrder?: string[];
    /** Order of homepage sections: built-in IDs ('hero','events','blog','feed') and page IDs ('page:/about') */
    homepageSectionOrder?: string[];
    /** NIP-19 gateway URL (e.g. https://nostr.at or https://njump.me) */
    nip19Gateway?: string;
    /** Blossom relays for media storage */
    blossomRelays?: string[];
    /** Blossom relays to exclude (e.g. if the default Nostr relay doesn't support Blossom) */
    excludedBlossomRelays?: string[];
    /** Order of zaplytics sections */
    zaplyticsSectionOrder?: string[];
    /** Whether admin settings are read-only for non-master admins */
    readOnlyAdminAccess?: boolean;
    /** Whether automatic 24h media harvesting is enabled (daily cron + immediate run) */
    autoHarvest24h?: boolean;
    /** Last time the site config was updated from/to Nostr */
    updatedAt?: number;
  };
  /** Navigation configuration */
  navigation?: Array<{
    id: string;
    name: string;
    href: string;
    isSubmenu: boolean;
    isLabelOnly?: boolean;
    parentId?: string;
  }>;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
