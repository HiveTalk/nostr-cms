import { useMemo } from 'react';
import { nip19 } from 'nostr-tools';
import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageLoadingIndicator } from '@/components/PageLoadingIndicator';
import { useAppContext } from '@/hooks/useAppContext';
import { useDefaultRelay } from '@/hooks/useDefaultRelay';
import { useNostr } from '@nostrify/react';
import { type NostrEvent } from '@nostrify/nostrify';
import { getMasterPubkey } from '@/lib/relay';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { isEventLive } from '@/lib/calendarEvents';
import type { UnifiedCalendarEvent } from '@/lib/calendarEvents';
import { useQuery } from '@tanstack/react-query';
import { useHomepagePages } from '@/components/admin/settings/useHomepagePages';
import { getPageLabel, BUILTIN_HOMEPAGE_SECTION_IDS, type HomepagePage } from '@/components/admin/settings/types';
import { PageContent } from '@/components/admin/settings/PageContent';
import Navigation from '@/components/Navigation';
import { FeedItem } from '@/components/FeedItem';
import { normalizeToHexPubkeys } from '@/lib/utils';
import { Calendar, MapPin, Clock, ArrowRight, Edit, Video } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface BlogPost {
  id: string;
  title: string;
  content: string;
  published: boolean;
  created_at: number;
  image?: string;
  pubkey: string;
}

function AuthorInfo({ pubkey }: { pubkey: string }) {
  const { data: author } = useAuthor(pubkey);
  
  let npub = '';
  try {
    if (pubkey && /^[0-9a-f]{64}$/.test(pubkey)) {
      npub = nip19.npubEncode(pubkey);
    }
  } catch (e) {
    console.error('Error encoding npub:', e);
  }

  return (
    <div className="flex items-center gap-2 mb-4">
      <Avatar className="h-6 w-6">
        <AvatarImage src={author?.metadata?.picture} />
        <AvatarFallback>{author?.metadata?.name?.charAt(0) || '?'}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        {npub ? (
          <a 
            href={`https://nostr.at/${npub}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium hover:underline"
          >
            {author?.metadata?.name || author?.metadata?.display_name || 'Anonymous'}
          </a>
        ) : (
          <span className="text-xs font-medium">
            {author?.metadata?.name || author?.metadata?.display_name || 'Anonymous'}
          </span>
        )}
      </div>
    </div>
  );
}

function HeroSection() {
  const { config } = useAppContext();

  const heroConfig = {
    heroTitle: config.siteConfig?.heroTitle || 'Welcome to Our Community',
    heroSubtitle: config.siteConfig?.heroSubtitle || 'Join us for amazing meetups and events',
    heroBackground: config.siteConfig?.heroBackground || '',
    // Older config events may contain the image URL but not the newer type tag.
    // Preserve the configured image instead of silently rendering no background.
    heroBackgroundType: config.siteConfig?.heroBackgroundType || (config.siteConfig?.heroBackground ? 'image' : 'none'),
    heroBackgroundColor: config.siteConfig?.heroBackgroundColor || '#1a1a2e',
    heroTextColor: config.siteConfig?.heroTextColor || '#ffffff',
    heroBanner: config.siteConfig?.heroBanner || '',
  };

  // Use configured heroButtons if available
  const configuredButtons = config.siteConfig?.heroButtons;

  // If no heroButtons configured, fall back to checking navigation menu for /events and /blog
  const heroButtons = configuredButtons && configuredButtons.length > 0
    ? configuredButtons
    : (() => {
        // Fallback: check if /events and /blog exist in navigation
        const hasEventsInNav = config.navigation?.some(item => item.href === '/events' && !item.isSubmenu && !item.parentId);
        const showEventsButton = config.siteConfig?.showEvents !== false && hasEventsInNav;

        const hasBlogInNav = config.navigation?.some(item => item.href === '/blog' && !item.isSubmenu && !item.parentId);
        const showBlogButton = config.siteConfig?.showBlog !== false && hasBlogInNav;

        const buttons: Array<{ label: string; href: string; variant?: 'default' | 'outline' }> = [];
        if (showEventsButton) {
          buttons.push({ label: 'View Events', href: '/events', variant: 'default' });
        }
        if (showBlogButton) {
          buttons.push({ label: 'Read Blog', href: '/blog', variant: 'outline' });
        }
        return buttons;
      })();

  // Filter out buttons with empty labels or hrefs (disabled buttons)
  const activeButtons = heroButtons.filter(btn => btn.label && btn.href);

  const bgType = heroConfig.heroBackgroundType; // 'none' | 'image' | 'color'
  const useImage = bgType === 'image' && !!heroConfig.heroBackground;
  const useColor = bgType === 'color';
  const textColor = heroConfig.heroTextColor;

  return (
    <>
      {/* Optional banner image between nav and hero.
          The image is height-capped and centered; sides are filled with
          the actual edge colors of the image (stretched + lightly blurred). */}
      {heroConfig.heroBanner && (
        <div className="relative w-full overflow-hidden">
          {/* Stretched fill background: the image is stretched to fill the
              full container so the actual edge pixels extend to the sides.
              A light blur smooths pixelation without losing the real colors. */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url('${heroConfig.heroBanner}')`,
              backgroundSize: '100% 100%',
              backgroundPosition: 'center',
              filter: 'blur(12px)',
            }}
          />
          {/* Actual image, centered, not cropped, height-capped */}
          <div className="relative flex items-center justify-center py-4">
            <img
              src={heroConfig.heroBanner}
              alt=""
              className="max-h-[400px] w-auto max-w-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Hero section: fixed height for image bg, auto height for color/none bg */}
      <div className={useImage ? "relative h-[600px] overflow-hidden" : "relative overflow-hidden"}>
        {/* Background */}
        {useImage ? (
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url('${heroConfig.heroBackground}')` }}
          >
            <div className="absolute inset-0 bg-black/40" />
          </div>
        ) : useColor ? (
          <div
            className="absolute inset-0"
            style={{ backgroundColor: heroConfig.heroBackgroundColor }}
          />
        ) : null}

        {/* Content */}
        <div className={`relative isolate flex items-center justify-center ${useImage ? 'h-full' : 'py-20 sm:py-28'}`}>
          <div className="text-center px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
            <h1
              className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6"
              style={{ color: textColor }}
            >
              {heroConfig.heroTitle}
            </h1>
            <p
              className="text-xl sm:text-2xl mb-8 max-w-2xl mx-auto"
              style={{ color: textColor, opacity: 0.9 }}
            >
              {heroConfig.heroSubtitle}
            </p>
            {activeButtons.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                {activeButtons.map((button, index) => (
                  <Button
                    key={index}
                    size="lg"
                    variant={button.variant === 'outline' ? 'outline' : 'default'}
                    className={`text-lg px-8 py-3 ${button.variant === 'outline' ? 'hover:bg-white hover:text-black' : ''}`}
                    style={button.variant === 'outline' ? {
                      color: textColor,
                      borderColor: textColor,
                    } : undefined}
                    asChild
                  >
                    <Link to={button.href}>
                      {button.label}
                      {button.variant !== 'outline' && <ArrowRight className="ml-2 h-5 w-5" />}
                    </Link>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function EventsSection({ events }: { events: UnifiedCalendarEvent[] }) {
  const { config } = useAppContext();
  const showEvents = config.siteConfig?.showEvents !== false;
  const maxEvents = config.siteConfig?.maxEvents || 6;

  if (!showEvents) return null;

  const now = Math.floor(Date.now() / 1000);
  const upcomingEvents = events
    .filter(event => {
      const isOngoing = event.end ? event.end > now : event.start > now;
      return isOngoing || isEventLive(event);
    })
    .slice(0, maxEvents);

  const getBadge = (event: UnifiedCalendarEvent) => {
    if (event.type === 'live') {
      if (event.status === 'live') return { label: 'LIVE NOW', variant: 'destructive' as const, pulse: true };
      if (event.status === 'ended') return { label: 'Ended', variant: 'outline' as const };
      return { label: 'Live', variant: 'secondary' as const };
    }
    if (event.status === 'tentative') return { label: 'Tentative', variant: 'secondary' as const };
    if (event.status === 'cancelled') return { label: 'Cancelled', variant: 'outline' as const };
    return { label: event.status || 'Confirmed', variant: 'default' as const };
  };

  return (
    <section className="py-16 bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Upcoming Events</h2>
          <p className="text-lg text-muted-foreground">
            Join us for our next meetups and gatherings
          </p>
        </div>

        {upcomingEvents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {upcomingEvents.map((event) => {
              const badge = getBadge(event);
              return (
                <Card key={event.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                  {event.image && (
                    <div className="h-48 bg-cover bg-center" style={{ backgroundImage: `url('${event.image}')` }} />
                  )}
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">{event.title}</CardTitle>
                      <Badge variant={badge.variant} className={badge.pulse ? 'animate-pulse' : ''}>
                        {badge.label}
                      </Badge>
                    </div>
                    {event.summary && (
                      <p className="text-sm text-muted-foreground">{event.summary}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        {new Date(event.start * 1000).toLocaleDateString()}
                        {event.end && ` - ${new Date(event.end * 1000).toLocaleDateString()}`}
                      </div>
                      {(event.kind === 31923 || event.type === 'live') && (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {new Date(event.start * 1000).toLocaleTimeString()}
                        </div>
                      )}
                      {event.type === 'calendar' && event.location && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          {event.location}
                        </div>
                      )}
                      {event.type === 'live' && event.room && (
                        <div className="flex items-center gap-2">
                          <Video className="h-4 w-4" />
                          <span>{event.room.name}</span>
                          {event.room.serviceUrl && (
                            <a
                              href={event.room.serviceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline text-xs"
                            >
                              (Join Room)
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <Button className="w-full mt-4" asChild>
                      <Link to={`/event/${event.id}`}>View Details</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No upcoming events</h3>
              <p className="text-muted-foreground">Check back soon for new events!</p>
            </CardContent>
          </Card>
        )}

        <div className="text-center mt-12">
          <Button variant="outline" size="lg" asChild>
            <Link to="/events">View All Events</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function BlogSection({ posts }: { posts: BlogPost[] }) {
  const { config } = useAppContext();
  const showBlog = config.siteConfig?.showBlog !== false;
  const maxPosts = config.siteConfig?.maxBlogPosts || 3;

  if (!showBlog) return null;

  const publishedPosts = posts
    .filter(post => post.published)
    .slice(0, maxPosts);

  return (
    <section className="py-16 bg-muted/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Latest Blog Posts</h2>
          <p className="text-lg text-muted-foreground">
            Stay updated with our community news and insights
          </p>
        </div>

        {publishedPosts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {publishedPosts.map((post) => (
              <Card key={post.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="text-lg line-clamp-2">{post.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {new Date(post.created_at * 1000).toLocaleDateString()}
                  </p>
                </CardHeader>
                <CardContent>
                  <AuthorInfo pubkey={post.pubkey} />
                  <div className="text-sm text-muted-foreground line-clamp-3 mb-4 prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {post.content.slice(0, 150) + (post.content.length > 150 ? '...' : '')}
                    </ReactMarkdown>
                  </div>
                  <Button className="w-full" asChild>
                    <Link to={`/blog/${post.id}`}>Read More</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Edit className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No blog posts yet</h3>
              <p className="text-muted-foreground">Check back soon for new content!</p>
            </CardContent>
          </Card>
        )}

        <div className="text-center mt-12">
          <Button variant="outline" size="lg" asChild>
            <Link to="/blog">View All Posts</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function FeedSection({ notes }: { notes: NostrEvent[] }) {
  const { config } = useAppContext();
  const showFeed = config.siteConfig?.showFeed === true;
  const maxNotes = config.siteConfig?.maxFeedNotes || 5;

  if (!showFeed) return null;
  if (notes.length === 0) return null;

  const displayNotes = notes.slice(0, maxNotes);

  return (
    <section className="py-16">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Community Feed</h2>
          <p className="text-lg text-muted-foreground">
            Latest notes from our community
          </p>
        </div>

        <div className="space-y-4">
          {displayNotes.map((note) => (
            <FeedItem key={note.id} event={note} />
          ))}
        </div>

        <div className="text-center mt-12">
          <Button variant="outline" size="lg" asChild>
            <Link to="/feed">View Full Feed</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function PageSection({ page }: { page: HomepagePage }) {
  const title = getPageLabel(page.path);

  return (
    <section className="py-16 bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-4">{title}</h2>
        </div>
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <PageContent content={page.content} />
        </div>
        <div className="text-center mt-12">
          <Button variant="outline" size="lg" asChild>
            <Link to={page.path}>View Full Page</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

const Index = ({ preview = false }: { preview?: boolean } = {}) => {
  const { config } = useAppContext();
  const { nostr } = useDefaultRelay();

  // Fetch events (calendar + live) using the shared unified calendar hook
  const { data: events = [], isLoading: eventsLoading } = useCalendarEvents(getMasterPubkey(), 'all');

  // Fetch blog posts
  const blogAuthors = useMemo(() => normalizeToHexPubkeys(config.siteConfig?.blogNpubs || []), [config.siteConfig?.blogNpubs]);
  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ['blog-posts', config.siteConfig?.defaultRelay, config.siteConfig?.adminRoles, blogAuthors],
    queryFn: async () => {
      const signal = AbortSignal.timeout(5000);
      const postList = await nostr!.query([
        { kinds: [30023], limit: 50, ...(blogAuthors.length > 0 ? { authors: blogAuthors } : {}) }
      ], { signal });

      const adminRoles = config.siteConfig?.adminRoles || {};
      const masterPubkey = getMasterPubkey();

      return postList
        .filter(event => {
          const authorPubkey = event.pubkey.toLowerCase().trim();
          // An explicit author allowlist replaces the role-based rule — when
          // set, only listed authors' posts appear (the author need not be an
          // admin or the master user).
          if (blogAuthors.length > 0) {
            if (!blogAuthors.includes(authorPubkey)) return false;
          } else if (authorPubkey !== masterPubkey && adminRoles[authorPubkey] !== 'publisher') return false;
          
          // Double check: don't show Kind 30023 if it's explicitly marked as NOT published
          const isPublished = event.tags.find(([name]) => name === 'published')?.[1] !== 'false';
          return isPublished;
        })
        .map(event => ({
        id: event.id,
        title: event.tags.find(([name]) => name === 'title')?.[1] || 'Untitled',
        content: event.content,
        published: event.tags.find(([name]) => name === 'published')?.[1] === 'true' || !event.tags.find(([name]) => name === 'published'),
        created_at: event.created_at,
        pubkey: event.pubkey,
      }));
    },
    enabled: !!nostr,
  });

  // Fetch feed notes (only if showFeed is enabled)
  const showFeed = config.siteConfig?.showFeed === true;
  const feedNpubs = config.siteConfig?.feedNpubs || [];
  const maxFeedNotes = config.siteConfig?.maxFeedNotes || 5;
  const { nostr: nostrGlobal } = useNostr();

  const pubkeys = useMemo(() => normalizeToHexPubkeys(feedNpubs), [feedNpubs]);

  const { data: feedNotes = [] } = useQuery({
    queryKey: ['homepage-feed-notes', pubkeys],
    queryFn: async () => {
      if (pubkeys.length === 0) return [];
      const signal = AbortSignal.timeout(10000);
      const events = await nostrGlobal!.query([
        { kinds: [1], authors: pubkeys, limit: maxFeedNotes * 2 }
      ], { signal });
      return events
        .filter(e => !e.tags.some(([t]) => t === 'e' || t === 'a')) // skip replies
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, maxFeedNotes * 2);
    },
    enabled: showFeed && pubkeys.length > 0 && !!nostrGlobal,
    staleTime: 60000,
  });

  // Fetch kind 34128 pages flagged as homepage sections.
  const { data: homepagePages = [], isLoading: homepagePagesLoading } = useHomepagePages({
    staleTime: 60000,
    adminRoles: config.siteConfig?.adminRoles,
  });

  // Build a lookup of page sections by their section ID (page:<path>)
  const pageSectionMap = useMemo(() => {
    const map = new Map<string, HomepagePage>();
    for (const page of homepagePages) {
      map.set(`page:${page.path}`, page);
    }
    return map;
  }, [homepagePages]);

  const siteTitle = config.siteConfig?.title || 'Community Meetup Site';
  const pageTitle = siteTitle;
  const pageDescription = config.siteConfig?.heroSubtitle || 'Join us for amazing meetups and events';
  const previewImage = config.siteConfig?.ogImage;

  // Skip SEO side effects in preview mode to avoid leaking meta tags
  useSeoMeta(
    preview ? {} : {
    title: pageTitle,
    description: pageDescription,
    ogTitle: pageTitle,
    ogDescription: pageDescription,
    ogType: 'website',
    ogImage: previewImage,
    twitterCard: 'summary_large_image',
    twitterTitle: pageTitle,
    twitterDescription: pageDescription,
    twitterImage: previewImage,
  }
  );

  if (eventsLoading || postsLoading || homepagePagesLoading) {
    return <PageLoadingIndicator />;
  }

  // Build the ordered list of homepage sections.
  // Built-in IDs: hero, events, blog, feed.
  // Page IDs: page:<path> (e.g. page:/about).
  // Reconcile: keep known IDs in order, append any page sections not yet in the order.
  const configuredOrder = config.siteConfig?.homepageSectionOrder?.length
    ? config.siteConfig.homepageSectionOrder
    : [...BUILTIN_HOMEPAGE_SECTION_IDS];
  const pageIds = homepagePages.map(p => `page:${p.path}`);
  const knownIds = new Set([...BUILTIN_HOMEPAGE_SECTION_IDS, ...pageIds]);
  const sectionOrder = [
    ...configuredOrder.filter(id => knownIds.has(id)),
    ...pageIds.filter(id => !configuredOrder.includes(id)),
  ];

  return (
    <div className="min-h-screen">
      <Navigation />
      {sectionOrder.map((sectionId) => {
        if (sectionId.startsWith('page:')) {
          const page = pageSectionMap.get(sectionId);
          if (!page) return null;
          return <PageSection key={sectionId} page={page} />;
        }
        switch (sectionId) {
          case 'hero':
            return <HeroSection key="hero" />;
          case 'events':
            return <EventsSection key="events" events={events} />;
          case 'blog':
            return <BlogSection key="blog" posts={posts} />;
          case 'feed':
            return <FeedSection key="feed" notes={feedNotes} />;
          default:
            return null;
        }
      })}
    </div>
  );
};

export default Index;