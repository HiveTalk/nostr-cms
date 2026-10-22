import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageLoadingIndicator } from '@/components/PageLoadingIndicator';
import { useQuery } from '@tanstack/react-query';
import { useDefaultRelay } from '@/hooks/useDefaultRelay';
import { getMasterPubkey } from '@/lib/relay';
import { useAppContext } from '@/hooks/useAppContext';
import Navigation from '@/components/Navigation';
import { Search, Calendar, Edit, RefreshCw } from 'lucide-react';
import { AuthorInfo } from '@/components/AuthorInfo';
import { normalizeToHexPubkeys } from '@/lib/utils';
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

export default function BlogPage() {
  const { config } = useAppContext();
  const { nostr } = useDefaultRelay();
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const blogAuthors = normalizeToHexPubkeys(config.siteConfig?.blogNpubs || []);
  const { data: posts = [], isLoading, refetch } = useQuery({
    queryKey: ['blog-posts', config.siteConfig?.adminRoles, blogAuthors],
    queryFn: async () => {
      const signal = AbortSignal.timeout(5000);
      const postList = await nostr!.query([
        { kinds: [30023], limit: 100, ...(blogAuthors.length > 0 ? { authors: blogAuthors } : {}) }
      ], { signal });

      const adminRoles = config.siteConfig?.adminRoles || {};
      const masterPubkey = getMasterPubkey();

      return postList
        .filter(event => {
          const authorPubkey = event.pubkey.toLowerCase().trim();
          // An explicit author allowlist replaces the role-based rule — when
          // set, only listed authors' posts appear.
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
      })) as BlogPost[];
    },
    enabled: !!nostr,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredPosts = posts.filter(post => 
    post.published && (
      searchTerm === '' ||
      post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.content.toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const siteTitle = config.siteConfig?.title || 'Community Meetup';
  const pageTitle = `Blog - ${siteTitle}`;
  const pageDescription = 'Read our latest blog posts and community updates.';
  const previewImage = config.siteConfig?.ogImage;

  useSeoMeta({
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
  });

  if (isLoading) {
    return <PageLoadingIndicator />;
  }

  return (
    <div className="min-h-screen">
      <Navigation />
      <div className="py-8">
        <div className="max-w-4xl mx-auto px-4 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Blog</h1>
            <p className="text-lg text-muted-foreground">
              Read our latest community updates and insights
            </p>
            <div className="mt-4">
              <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh Posts
              </Button>
            </div>
          </div>

          {/* Search */}
          <Card>
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search blog posts..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          {/* Blog Posts */}
          {filteredPosts.length > 0 ? (
            <div className="grid grid-cols-1 gap-6">
              {filteredPosts.map((post) => (
                <Card key={post.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xl line-clamp-2">{post.title}</CardTitle>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {new Date(post.created_at * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <AuthorInfo pubkey={post.pubkey} />
                    <div className="text-base text-muted-foreground line-clamp-3 mb-4 prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {post.content.slice(0, 300) + (post.content.length > 300 ? '...' : '')}
                      </ReactMarkdown>
                    </div>
                    <div className="flex justify-end">
                      <Button asChild>
                        <Link to={`/blog/${post.id}`}>Read More</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Edit className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No blog posts found</h3>
                <p className="text-muted-foreground">
                  {searchTerm 
                    ? 'No posts match your search. Try different keywords.'
                    : 'No published blog posts yet.'
                  }
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}