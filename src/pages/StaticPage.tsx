import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDefaultRelay } from '@/hooks/useDefaultRelay';
import { useBlossomRelays } from '@/hooks/useBlossomRelays';
import { getMasterPubkey } from '@/lib/relay';
import { PageLoadingIndicator } from '@/components/PageLoadingIndicator';
import { Button } from '@/components/ui/button';
import Navigation from '@/components/Navigation';
import { useAppContext } from '@/hooks/useAppContext';
import { useEffect, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { RefreshCw } from 'lucide-react';
import DOMPurify from 'dompurify';
import { PageContent } from '@/components/admin/settings/PageContent';
import { sha256 as sha256sum } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export default function StaticPage({ pathOverride }: { pathOverride?: string }) {
  const { config: appContext } = useAppContext();
  const { path } = useParams<{ path: string }>();
  const { nostr: defaultRelay } = useDefaultRelay();
  const blossomRelays = useBlossomRelays();
  const [content, setContent] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fullPath = pathOverride || `/${path}`;

  useEffect(() => {
    if (!pathOverride && path) {
      try {
        nip19.decode(path);
        const _prefixes = ['npub', 'nprofile', 'note', 'nevent', 'naddr'];
        // NIP-19 identifier detected — handled by router
      } catch {
        // Not a valid NIP-19, continue as static page
      }
    }
  }, [path, pathOverride]);

  const { data: pageEvent, isLoading: isEventLoading, error, refetch } = useQuery({
    queryKey: ['static-page', fullPath, appContext.siteConfig?.adminRoles],
    queryFn: async () => {
      const signal = AbortSignal.timeout(5000);
      
      const unslashedPath = fullPath.startsWith('/') ? fullPath.slice(1) : fullPath;
      const slashedPath = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
      
      const filters = [
        { kinds: [34128], '#d': [slashedPath, unslashedPath] }
      ];
      
      const events = await defaultRelay!.query(filters, { signal });
      
      const adminRoles = appContext.siteConfig?.adminRoles || {};
      const masterPubkey = getMasterPubkey();
      
      return events
        .filter(event => {
          const authorPubkey = event.pubkey.toLowerCase().trim();
          if (authorPubkey === masterPubkey) return true;
          return adminRoles[authorPubkey] === 'publisher';
        })
        .sort((a, b) => b.created_at - a.created_at)[0] || null;
    },
    enabled: !!defaultRelay && !!fullPath,
    staleTime: 0,
    retry: 2,
  });

  if (error) {
    console.error('StaticPage: Error fetching event:', error);
  }

  useEffect(() => {
    async function fetchFromBlossom() {
      if (!pageEvent) return;

      const sha256 = pageEvent.tags.find(([name]) => name === 'sha256')?.[1]?.toLowerCase();
      if (!sha256) {
        // Fallback to event content if no sha256 (though our admin adds it)
        setContent(pageEvent.content);
        return;
      }

      try {
        // Try all configured Blossom servers (local relay first, then others)
        const servers = blossomRelays.length > 0
          ? blossomRelays
          : ['https://blossom.primal.net/'];
        let fetchedContent = '';

        for (const server of servers) {
          try {
            const response = await fetch(`${server}${sha256}`);
            if (response.ok) {
              const bytes = await response.arrayBuffer();
              // Verify the blob matches the sha256 tag — a hostile or
              // misconfigured Blossom server could otherwise serve arbitrary
              // content under a trusted page's hash.
              if (bytesToHex(sha256sum(new Uint8Array(bytes))) !== sha256.toLowerCase()) {
                console.warn(`Blossom hash mismatch from ${server}, skipping`);
                continue;
              }
              fetchedContent = new TextDecoder().decode(bytes);
              break;
            }
          } catch (e) {
            console.error(`Failed to fetch from ${server}:`, e);
          }
        }

        if (fetchedContent) {
          // If it's a full HTML doc, extract just the body
          if (fetchedContent.includes('<body>')) {
            const bodyMatch = fetchedContent.match(/<body>([\s\S]*)<\/body>/i);
            setContent(bodyMatch ? bodyMatch[1] : fetchedContent);
          } else {
            setContent(fetchedContent);
          }
        } else {
          setContent(pageEvent.content);
        }
      } catch (error) {
        console.error('Error fetching from Blossom:', error);
        setContent(pageEvent.content);
      }
    }

    fetchFromBlossom();
  }, [pageEvent, blossomRelays]);

  if (isEventLoading) {
    return <PageLoadingIndicator />;
  }

  if (!pageEvent && !isEventLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="max-w-4xl mx-auto px-4 py-12 text-center">
          <h1 className="text-4xl font-bold mb-4">404</h1>
          <p className="text-muted-foreground mb-8">Page not found for path: {fullPath}</p>
          <p className="text-muted-foreground mb-8">No event found on the default relay.</p>
          <Button onClick={() => refetch()} variant="outline">
            Try Again
          </Button>
        </main>
      </div>
    );
  }

  const isHtml = content?.trim().startsWith('<');

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-6">
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Page
          </Button>
        </div>
        <article className="prose prose-slate dark:prose-invert max-w-none">
          {isHtml ? (
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content || '', {
              USE_PROFILES: { html: true },
              ADD_TAGS: ['iframe', 'style', 'svg'],
              ADD_ATTR: [
                'target', 'allow', 'allowfullscreen', 'frameborder',
                'scrolling', 'width', 'height', 'referrerpolicy',
                'loading', 'sandbox',
              ],
            }) }} />
          ) : (
            <PageContent content={content || ''} />
          )}
        </article>
      </main>
    </div>
  );
}
