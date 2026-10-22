import { ReactNode, useEffect, useCallback, useMemo } from 'react';
import { z } from 'zod';
import { useHead, useSeoMeta } from '@unhead/react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType, type Theme, type RelayMetadata } from '@/contexts/AppContext';
import { getMasterPubkey, getDefaultRelayUrl } from '@/lib/relay';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
}

// Zod schema for RelayMetadata validation
// Use z.string() instead of z.string().url() so a single bad URL doesn't
// break the entire config parse. Invalid URLs are filtered out after parsing.
const RelayMetadataSchema = z.object({
  relays: z.array(z.object({
    url: z.string(),
    read: z.boolean(),
    write: z.boolean(),
  })),
  updatedAt: z.number(),
}) satisfies z.ZodType<RelayMetadata>;

// Zod schema for AppConfig validation
const AppConfigSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  relayMetadata: RelayMetadataSchema,
  siteConfig: z.object({
    title: z.string().optional(),
    logo: z.string().optional(),
    favicon: z.string().optional(),
    ogImage: z.string().optional(),
    heroTitle: z.string().optional(),
    heroSubtitle: z.string().optional(),
    heroBackground: z.string().optional(),
    heroBackgroundType: z.enum(['none', 'image', 'color']).optional(),
    heroBackgroundColor: z.string().optional(),
    heroTextColor: z.string().optional(),
    heroBanner: z.string().optional(),
    heroButtons: z.array(z.object({
      label: z.string(),
      href: z.string(),
      variant: z.enum(['default', 'outline']).optional(),
    })).optional(),
    showEvents: z.boolean().optional(),
    showBlog: z.boolean().optional(),
    showFeed: z.boolean().optional(),
    maxEvents: z.number().optional(),
    maxBlogPosts: z.number().optional(),
    maxFeedNotes: z.number().optional(),
    defaultRelay: z.string().optional(),
    publishRelays: z.array(z.string()).optional(),
    adminRoles: z.record(z.string(), z.enum(['publisher', 'user'])).optional(),
    tweakcnThemeUrl: z.string().optional(),
    sectionOrder: z.array(z.string()).optional(),
    homepageSectionOrder: z.array(z.string()).optional(),
    feedNpubs: z.array(z.string()).optional(),
    blogNpubs: z.array(z.string()).optional(),
    feedReadFromPublishRelays: z.boolean().optional(),
    blossomRelays: z.array(z.string()).optional(),
    excludedBlossomRelays: z.array(z.string()).optional(),
    updatedAt: z.number().optional(),
    readOnlyAdminAccess: z.boolean().optional(),
    autoHarvest24h: z.boolean().optional(),
  }).optional(),
  navigation: z.array(z.object({
    id: z.string(),
    name: z.string(),
    href: z.string(),
    isSubmenu: z.boolean(),
    isLabelOnly: z.boolean().optional(),
    parentId: z.string().optional(),
  })).optional(),
}) satisfies z.ZodType<AppConfig>;

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
  } = props;

  // App configuration state with localStorage persistence
  const [rawConfig, setConfig] = useLocalStorage<Partial<AppConfig>>(
    storageKey,
    {},
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);

        // Data migration: Handle old navigation object format
        if (parsed && typeof parsed === 'object' && parsed.navigation && typeof parsed.navigation === 'object' && !Array.isArray(parsed.navigation) && 'navigation' in parsed.navigation) {
          parsed.navigation = (parsed.navigation as Record<string, unknown>).navigation;
        }

        // Data migration: adminRoles renamed from 'primary'/'secondary' to
        // 'publisher'/'user'. Map any old values so existing localStorage
        // and 30078 event data continues to work.
        if (parsed?.siteConfig?.adminRoles && typeof parsed.siteConfig.adminRoles === 'object') {
          const migrated: Record<string, string> = {};
          for (const [pk, role] of Object.entries(parsed.siteConfig.adminRoles)) {
            if (role === 'primary') migrated[pk] = 'publisher';
            else if (role === 'secondary') migrated[pk] = 'user';
            else migrated[pk] = role as string;
          }
          parsed.siteConfig.adminRoles = migrated;
        }

        const config = AppConfigSchema.partial().parse(parsed);

        // Filter out relays with empty or invalid URLs (must be ws: or wss:)
        if (config.relayMetadata?.relays) {
          config.relayMetadata = {
            ...config.relayMetadata,
            relays: config.relayMetadata.relays.filter(r => {
              try {
                if (!r.url) return false;
                const parsed = new URL(r.url);
                return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
              } catch { return false; }
            }),
          };
        }

        return config;
      }
    }
  );

  // Generic config updater with callback pattern
  const updateConfig = useCallback((updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => {
    setConfig(updater);
  }, [setConfig]);

  const config = useMemo(() => {
    // Start with defaultConfig
    const merged = { ...defaultConfig };

    const masterPubkey = getMasterPubkey();

    // Merge rawConfig (localStorage)
    if (rawConfig.theme) merged.theme = rawConfig.theme;
    if (rawConfig.relayMetadata) merged.relayMetadata = rawConfig.relayMetadata;

    // Deep merge siteConfig to ensure we don't lose defaults
    if (defaultConfig.siteConfig || rawConfig.siteConfig) {
      merged.siteConfig = {
        ...(defaultConfig.siteConfig || {}),
        ...(rawConfig.siteConfig || {}),
      };

      // Environment variable relay ALWAYS takes precedence over localStorage.
      // This prevents stale relay URLs from persisting after switching VITE_DEFAULT_RELAY.
      const envRelay = getDefaultRelayUrl();
      if (envRelay && merged.siteConfig.defaultRelay !== envRelay) {
        merged.siteConfig.defaultRelay = envRelay;
      }

      // Ensure adminRoles exists
      if (!merged.siteConfig.adminRoles) {
        merged.siteConfig.adminRoles = {};
      }

      // INJECT MASTER PUBKEY: Ensure master user is always a publisher
      if (masterPubkey) {
        merged.siteConfig.adminRoles = {
          ...merged.siteConfig.adminRoles,
          [masterPubkey]: 'publisher'
        };
      }
    }

    // Use rawConfig navigation if it exists, otherwise defaultConfig
    if (rawConfig.navigation) merged.navigation = rawConfig.navigation;

    return merged;
  }, [defaultConfig, rawConfig]);

  const appContextValue: AppContextType = useMemo(() => ({
    config,
    updateConfig,
  }), [config, updateConfig]);

  // Apply global SEO meta tags
  useGlobalSeo(config);

  // Apply theme effects to document
  useApplyTheme(config.theme);

  // Apply TweakCN theme if URL is provided
  useTweakCNTheme(config.siteConfig?.tweakcnThemeUrl);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Hook to fetch and apply TweakCN theme from a URL
 */
function useTweakCNTheme(themeUrl?: string) {
  useEffect(() => {
    if (!themeUrl) {
      // Remove existing TweakCN theme style tags if they exist
      const existingStyle = document.getElementById('tweakcn-theme');
      if (existingStyle) {
        existingStyle.remove();
      }
      const existingFonts = document.getElementById('tweakcn-fonts');
      if (existingFonts) {
        existingFonts.remove();
      }
      return;
    }

    const fetchTheme = async () => {
      try {
        const response = await fetch(themeUrl);
        if (!response.ok) throw new Error(`Failed to fetch theme: ${response.statusText}`);
        const themeData = await response.json();
        const vars = themeData.cssVars || themeData;

        // Inject Google Fonts if the theme uses them
        await injectGoogleFonts(vars);

        // TweakCN themes usually provide CSS variables in a specific format
        // We'll create a style tag and inject the variables
        let cssVars = '';

        // Handle both light and dark modes if provided in the JSON
        const formatVars = (entries: Record<string, string>, prefix = '') => {
          return Object.entries(entries)
            .map(([k, v]) => {
              // Map TweakCN names to our CSS variable names if they differ
              let varName = k === 'sidebar' ? 'sidebar-background' : k;
              // Add prefix if provided (e.g., 'font-' for Tailwind compatibility)
              if (prefix && !varName.startsWith(prefix)) {
                varName = prefix + varName;
              }
              return `--${varName}: ${v};`;
            })
            .join(' ');
        };

        // Theme-wide variables (including fonts) - apply to :root
        if (vars.theme) {
          cssVars += `:root { ${formatVars(vars.theme)} }\n`;
        }

        if (vars.light) {
          cssVars += `:root { ${formatVars(vars.light)} }\n`;
        }
        if (vars.dark) {
          cssVars += `.dark { ${formatVars(vars.dark)} }\n`;
        }

        // If it's just a flat object (fallback)
        if (!vars.light && !vars.dark && !vars.theme) {
          cssVars += `:root { ${formatVars(vars)} }`;
        }

        // Process the css object for @layer rules (e.g., typography, letter-spacing)
        if (themeData.css) {
          cssVars += processThemeCss(themeData.css);
        }

        let styleTag = document.getElementById('tweakcn-theme') as HTMLStyleElement;
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = 'tweakcn-theme';
          document.head.appendChild(styleTag);
        }
        styleTag.textContent = cssVars;
      } catch (error) {
        console.error('[useTweakCNTheme] Error applying TweakCN theme:', error);
      }
    };

    fetchTheme();
  }, [themeUrl]);
}

/**
 * Inject Google Fonts links for fonts specified in the theme
 */
async function injectGoogleFonts(vars: Record<string, Record<string, string>>) {
  const fontFamilies = new Set<string>();

  // Collect font families from all sections
  ['theme', 'light', 'dark'].forEach(section => {
    if (vars[section]) {
      ['font-sans', 'font-mono', 'font-serif'].forEach(fontVar => {
        const fontFamily = vars[section][fontVar];
        if (fontFamily) {
          // Extract font family names (before the comma/fallback)
          const fonts = fontFamily.split(',').map((f: string) => f.trim().replace(/['"]/g, '').replace(/\s*sans-serif\s*/i, '').replace(/\s*monospace\s*/i, '').replace(/\s*serif\s*/i, ''));
          fonts.forEach((font: string) => {
            if (font && !font.includes('system-ui') && !font.includes('Apple')) {
              fontFamilies.add(font);
            }
          });
        }
      });
    }
  });

  if (fontFamilies.size === 0) return;

  // Remove existing fonts link
  const existingLink = document.getElementById('tweakcn-fonts');
  if (existingLink) {
    existingLink.remove();
  }

  // Create Google Fonts link (subset to latin for performance)
  const fontNames = Array.from(fontFamilies).join('&family=').replace(/\s+/g, '+');
  const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${fontNames}&display=swap`;

  try {
    // Preload the fonts
    const link = document.createElement('link');
    link.id = 'tweakcn-fonts';
    link.rel = 'stylesheet';
    link.href = googleFontsUrl;
    document.head.appendChild(link);
  } catch (error) {
    console.warn('[useTweakCNTheme] Failed to load Google Fonts:', error);
  }
}

/**
 * Process the css object from TweakCN theme and convert to CSS string
 */
function processThemeCss(css: Record<string, unknown>): string {
  let cssString = '';

  if (!css) return cssString;

  // Process @layer base rules
  if (css['@layer base']) {
    cssString += '@layer base {';
    const baseRules = css['@layer base'];

    // Process each selector in @layer base
    Object.entries(baseRules).forEach(([selector, properties]) => {
      cssString += `  ${selector} {`;
      if (typeof properties === 'object' && properties !== null) {
        Object.entries(properties as Record<string, string>).forEach(([prop, value]) => {
          // Convert camelCase to kebab-case for CSS properties
          const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          cssString += `    ${cssProp}: ${value};`;
        });
      }
      cssString += '  }';
    });

    cssString += '}\n';
  }

  return cssString;
}

/**
 * Hook to apply global SEO meta tags based on site configuration
 */
function useGlobalSeo(config: AppConfig) {
  const siteConfig = config.siteConfig;

  useHead({
    link: [
      {
        key: 'favicon',
        rel: 'icon',
        href: siteConfig?.favicon || '/favicon.ico',
      },
    ],
  });

  const title = siteConfig?.title || 'My Meetup Site';
  const description = siteConfig?.heroSubtitle || 'Join us for amazing meetups and events';
  const ogImage = siteConfig?.ogImage || '';

  useSeoMeta({
    title,
    description,
    ogTitle: title,
    ogDescription: description,
    ogImage,
    twitterCard: 'summary_large_image',
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: ogImage,
  });
}

/**
 * Hook to apply theme changes to the document root
 */
function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // Handle system theme changes when theme is set to "system"
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');

      const systemTheme = mediaQuery.matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);
}