import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDefaultRelay } from '@/hooks/useDefaultRelay';
import { useToast } from '@/hooks/useToast';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Edit, Trash2, Eye, Layout, Share2, Image as ImageIcon, Loader2, Clock, Filter, RefreshCw, Search, ChevronDown, X, User, Repeat } from 'lucide-react';
import { MediaSelectorDialog } from './MediaSelectorDialog';
import { BlogVisibilityCard } from './BlogVisibilityCard';
import { SchedulePicker } from './SchedulePicker';
import { MarkdownToolbar } from './settings/MarkdownToolbar';
import { PageContent } from './settings/PageContent';
import { RepostDialog } from './RepostDialog';
import { useCreateScheduledPost, useUpdateScheduledPost } from '@/hooks/useScheduledPosts';
import { useSchedulerHealth } from '@/hooks/useSchedulerHealth';
import type { ScheduleConfig } from '@/components/admin/SchedulePicker';
import type { NostrEvent } from '@/types/scheduled';
import { uploadMediaFiles, mediaMimeType, type MediaUploadError } from '@/lib/mediaProcessing';
import { useAppContext } from '@/hooks/useAppContext';
import { useRemoteNostrJson } from '@/hooks/useRemoteNostrJson';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import type { NostrFilter } from '@nostrify/nostrify';

interface BlogPost {
  id: string;
  title: string;
  content: string;
  published: boolean;
  created_at: number;
  d: string;
  pubkey: string;
  kind: number;
  image?: string;
  sig: string;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function BlogPostCard({ post, user, searchQuery, onEdit, onDelete, relayUrl, publishRelays }: {
  post: BlogPost;
  user: { pubkey: string } | undefined;
  searchQuery: string;
  onEdit: (post: BlogPost) => void;
  onDelete: (post: BlogPost) => void;
  relayUrl: string;
  publishRelays: string[];
}) {
  const { data: author } = useAuthor(post.pubkey);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [repostOpen, setRepostOpen] = useState(false);

  // Filter by search query (title + content)
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    if (!post.title.toLowerCase().includes(q) && !post.content.toLowerCase().includes(q)) {
      return null;
    }
  }

  const displayName = author?.metadata?.name || author?.metadata?.display_name || `${post.pubkey.slice(0, 8)}...`;
  const canEdit = user && post.pubkey === user.pubkey;

  return (
    <Card className="hover:bg-muted/30 transition-colors">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-semibold break-words">{post.title}</h3>
              <Badge variant={post.published ? 'default' : 'secondary'} className="shrink-0">
                {post.published ? 'Published' : 'Draft'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={author?.metadata?.picture} alt={displayName} />
                <AvatarFallback><User className="h-3 w-3" /></AvatarFallback>
              </Avatar>
              <span className="text-sm text-muted-foreground">{displayName}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{timeAgo(post.created_at)}</span>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2 break-words">
              {post.content.replace(/[*#>`]/g, '').slice(0, 200)}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(true)} title="Preview post">
              <Eye className="h-4 w-4" />
            </Button>
            {post.published && (
              <Button variant="ghost" size="sm" onClick={() => setRepostOpen(true)} title="Schedule repost">
                <Repeat className="h-4 w-4" />
              </Button>
            )}
            {canEdit && (
              <>
                <Button variant="ghost" size="sm" onClick={() => onEdit(post)} title="Edit post">
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(post)} title="Delete post">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>

      {/* Preview dialog — renders post content inline, no new tab */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col" hideCloseButton>
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 pr-0">
            <DialogTitle className="text-wrap break-words pr-8">{post.title}</DialogTitle>
            <DialogClose asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 shrink-0" title="Close">
                <X className="h-5 w-5" />
              </Button>
            </DialogClose>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6 pb-2">
            {post.image && (
              <img src={post.image} alt={post.title} className="w-full h-auto max-h-[400px] object-contain rounded-lg mb-6" />
            )}
            <div className="prose prose-slate dark:prose-invert max-w-none">
              <PageContent content={post.content} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Repost dialog */}
      {repostOpen && (
        <RepostDialog
          open={repostOpen}
          onOpenChange={setRepostOpen}
          target={{
            id: post.id,
            pubkey: post.pubkey,
            kind: post.kind,
            content: post.content,
            tags: [
              ['title', post.title],
              ['d', post.d],
              ...(post.image ? [['image', post.image] as [string, string]] : []),
            ],
            created_at: post.created_at,
            sig: post.sig,
            d: post.d,
          }}
          relayUrl={relayUrl}
          publishRelays={publishRelays}
          thumbnailUrl={post.image}
          previewTitle={post.title}
        />
      )}
    </Card>
  );
}

export default function AdminBlog() {
  const location = useLocation();
  const { nostr, defaultRelayUrl, publishRelays: initialPublishRelays } = useDefaultRelay();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const { data: remoteNostrJson } = useRemoteNostrJson();
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [editingScheduledPostId, setEditingScheduledPostId] = useState<string | null>(null);
  const [selectedRelays, setSelectedRelays] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterByNostrJson, setFilterByNostrJson] = useState(false);
  const [postTab, setPostTab] = useState<'published' | 'drafts'>('published');
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    published: false,
    coverImage: '',
  });
  const [showCoverImageSelector, setShowCoverImageSelector] = useState(false);
  // Track which action is in progress so only the clicked button shows loading.
  // 'draft' = Save Draft, 'publish' = Publish/Schedule, null = idle.
  const [pendingAction, setPendingAction] = useState<'draft' | 'publish' | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>({
    enabled: false,
    scheduledFor: null,
  });

  const { mutateAsync: createScheduledPost } = useCreateScheduledPost();
  const { mutateAsync: updateScheduledPost } = useUpdateScheduledPost();
  const { data: isSchedulerHealthy } = useSchedulerHealth();

  // Derive blossom relays (same as AdminNotes)
  const blossomRelays = useMemo(() => {
    const storedRelays = config.siteConfig?.blossomRelays || [];
    const excludedRelays = config.siteConfig?.excludedBlossomRelays || [];
    const relays = [...storedRelays];
    const defaultRelay = config.siteConfig?.defaultRelay;

    if (defaultRelay) {
      let normalizedDefault = defaultRelay.replace(/\/$/, '');
      if (normalizedDefault.startsWith('wss://')) {
        normalizedDefault = normalizedDefault.replace('wss://', 'https://');
      } else if (normalizedDefault.startsWith('ws://')) {
        normalizedDefault = normalizedDefault.replace('ws://', 'http://');
      }

      const isExcluded = excludedRelays.includes(normalizedDefault);

      if ((normalizedDefault.startsWith('http://') || normalizedDefault.startsWith('https://')) && !relays.includes(normalizedDefault) && !isExcluded) {
        relays.unshift(normalizedDefault);
      }
    }

    return relays;
  }, [config.siteConfig?.blossomRelays, config.siteConfig?.defaultRelay, config.siteConfig?.excludedBlossomRelays]);

  // Handle editing a scheduled post from the Scheduled page
  useEffect(() => {
    const editingScheduledPost = location.state?.editingScheduledPost;
    if (editingScheduledPost && editingScheduledPost.kind === 30023) {
      // Populate form with scheduled post data
      setFormData({
        title: editingScheduledPost.title || '',
        content: editingScheduledPost.content || '',
        published: true, // Blog posts are always published when scheduled
        coverImage: editingScheduledPost.image || '',
      });
      setEditingScheduledPostId(editingScheduledPost.scheduledPostId);
      setScheduleConfig({
        enabled: true,
        scheduledFor: editingScheduledPost.scheduledFor ? new Date(editingScheduledPost.scheduledFor) : null,
      });
      setSelectedRelays(editingScheduledPost.relays || []);
      setIsCreating(true);
      // Clear the location state to prevent re-populating on re-renders
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const handleFileUpload = async (files: File[]) => {
    if (!files || files.length === 0 || !user) return;

    if (blossomRelays.length === 0) {
      toast({
        title: 'No Blossom Server',
        description: 'Please configure a Blossom server in Media settings first.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      const { results, warnings } = await uploadMediaFiles(files, blossomRelays, user.signer);

      const urls = results.map(r => r.url).filter(Boolean);

      if (urls.length > 0) {
        const urlText = urls.join('\n');
        const textarea = textareaRef.current;
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const newContent = formData.content.slice(0, start) + '\n' + urlText + '\n' + formData.content.slice(end);
          setFormData(prev => ({ ...prev, content: newContent }));
        } else {
          setFormData(prev => ({ ...prev, content: prev.content + '\n' + urlText }));
        }

        // TOAST_LIMIT is 1 — merge warnings into the success toast or they get displaced
        toast({
          title: 'Upload Successful',
          description: `Uploaded ${urls.length} file(s) to ${blossomRelays.length} server(s)` +
            (warnings.length ? ` — ${warnings.join(' ')}` : ''),
          variant: warnings.length ? 'destructive' : 'default',
        });
      }
    } catch (err) {
      console.error('Upload failed:', err);
      // uploadMediaFiles carries warnings from files that already uploaded —
      // merge into the error toast so they aren't lost to the failure
      const errWarnings = (err as MediaUploadError).warnings;
      toast({
        title: 'Upload Failed',
        description: (err as Error).message +
          (errWarnings?.length ? ` — ${errWarnings.join(' ')}` : ''),
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(Array.from(files));
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (files.length > 0) {
      e.preventDefault();
      handleFileUpload(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    // Required for drop to fire for file drags. Limited to 'Files' so native
    // text-drop behavior into the textarea is untouched.
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    // Claim all file drops (even non-media) so the browser can't navigate away.
    e.preventDefault();
    // file.type can be empty (e.g. .mkv on Linux) — sniff by extension
    const files = Array.from(e.dataTransfer.files)
      .filter(file => mediaMimeType(file).startsWith('image/') || mediaMimeType(file).startsWith('video/'));

    if (files.length > 0) {
      handleFileUpload(files);
    } else {
      toast({
        title: 'Unsupported files',
        description: 'Only images and videos can be uploaded.',
        variant: 'destructive',
      });
    }
  };

  // Initialize selected relays when publishRelays change
  useEffect(() => {
    if (initialPublishRelays.length > 0 && selectedRelays.length === 0) {
      setSelectedRelays(initialPublishRelays);
    }
  }, [initialPublishRelays, selectedRelays.length]);

  // Fetch blog posts
  const { data: allPosts, refetch } = useQuery({
    queryKey: ['admin-blog-posts-full', user?.pubkey],
    queryFn: async () => {
      const signal = AbortSignal.timeout(5000);
      const filters: NostrFilter[] = [{ kinds: [30023], limit: 100 }];

      // If user is logged in, also fetch their private drafts (Kind 31234)
      if (user?.pubkey) {
        filters.push({ kinds: [31234], authors: [user.pubkey], '#k': ['30023'], limit: 50 });
      }

      const events = (await nostr!.query(filters, { signal })).filter(event =>
        event.kind === 30023 ||
        (event.kind === 31234 && event.tags.some(([name, value]) => name === 'k' && value === '30023'))
      );

      const processedPosts = await Promise.all(events.map(async (event) => {
        const tags = event.tags || [];
        let content = event.content;
        let title = tags.find(([name]) => name === 'title')?.[1] || 'Untitled';
        // Kind 30023 is a published post by definition; only 31234 drafts are unpublished
        let published = event.kind === 30023;
        let d = tags.find(([name]) => name === 'd')?.[1] || event.id;
        let image = tags.find(([name]) => name === 'image')?.[1];

        // Handle Kind 31234 (NIP-37 Draft Wraps)
        if (event.kind === 31234) {
          published = false;
          try {
            if (user?.signer?.nip44) {
              const decrypted = await user.signer.nip44.decrypt(user.pubkey, event.content);
              const draftEvent = JSON.parse(decrypted);
              content = draftEvent.content || '';
              const draftTags = draftEvent.tags || [];
              title = draftTags.find(([name]: string[]) => name === 'title')?.[1] || title;
              d = draftTags.find(([name]: string[]) => name === 'd')?.[1] || d;
              image = draftTags.find(([name]: string[]) => name === 'image')?.[1] || image;
            } else if (user?.signer?.nip04) {
              const decrypted = await user.signer.nip04.decrypt(user.pubkey, event.content);
              const draftEvent = JSON.parse(decrypted);
              content = draftEvent.content || '';
              const draftTags = draftEvent.tags || [];
              title = draftTags.find(([name]: string[]) => name === 'title')?.[1] || title;
              d = draftTags.find(([name]: string[]) => name === 'd')?.[1] || d;
              image = draftTags.find(([name]: string[]) => name === 'image')?.[1] || image;
            } else {
              // Try to parse as unencrypted JSON if no decryption available
              try {
                const draftEvent = JSON.parse(event.content);
                content = draftEvent.content || '';
                const draftTags = draftEvent.tags || [];
                title = draftTags.find(([name]: string[]) => name === 'title')?.[1] || title;
                d = draftTags.find(([name]: string[]) => name === 'd')?.[1] || d;
                image = draftTags.find(([name]: string[]) => name === 'image')?.[1] || image;
              } catch {
                content = "[Encrypted Draft]";
              }
            }
          } catch (e) {
            console.error('Failed to decrypt draft:', e);
            content = "[Decryption Failed]";
          }
        }

        return {
          id: event.id,
          title,
          content,
          published,
          created_at: event.created_at,
          d,
          pubkey: event.pubkey,
          kind: event.kind,
          image,
          sig: event.sig,
        };
      }));

      // Deduplicate by d-tag+pubkey, keeping both published and draft versions
      // if they exist (so they appear in their respective tabs).
      const deduped = processedPosts.reduce((acc: BlogPost[], post) => {
        const existingIndex = acc.findIndex(p =>
          p.d === post.d && p.pubkey === post.pubkey && p.published === post.published
        );
        if (existingIndex === -1) {
          acc.push(post);
        } else {
          const existing = acc[existingIndex];
          // Keep whichever event is newer within the same published/draft category
          if (post.created_at > existing.created_at) {
            acc[existingIndex] = post;
          }
        }
        return acc;
      }, []);

      return deduped.sort((a, b) => b.created_at - a.created_at);
    },
    enabled: !!nostr,
  });

  // Filter posts based on nostr.json users
  const posts = filterByNostrJson && remoteNostrJson?.names
    ? allPosts?.filter(post => {
      const normalizedPubkey = post.pubkey.toLowerCase().trim();
      return Object.values(remoteNostrJson.names).some(
        pubkey => pubkey.toLowerCase().trim() === normalizedPubkey
      );
    })
    : allPosts;

  // Split into published and drafts for tabbed view
  const publishedPosts = posts?.filter(p => p.published) ?? [];
  const draftPosts = posts?.filter(p => !p.published) ?? [];
  const tabbedPosts = postTab === 'published' ? publishedPosts : draftPosts;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Check if form is dirty
  const isDirty = editingPost
    ? (formData.title !== editingPost.title || formData.content !== editingPost.content)
    : (formData.title.trim() !== '' || formData.content.trim() !== '');

  // Prevent accidental navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isCreating && isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isCreating, isDirty]);

  const handleCancel = () => {
    if (isDirty && !confirm('You have unsaved changes. Are you sure you want to discard them?')) {
      return;
    }
    setIsCreating(false);
    setEditingPost(null);
    setEditingScheduledPostId(null);
    setFormData({ title: '', content: '', published: false, coverImage: '' });
    setScheduleConfig({ enabled: false, scheduledFor: null });
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (!user || !formData.title.trim() || !formData.content.trim()) return;

    if (editingPost && editingPost.pubkey !== user.pubkey) {
      toast({
        title: "Error",
        description: "You cannot edit another user's post.",
        variant: "destructive"
      });
      return;
    }

    setPendingAction(asDraft ? 'draft' : 'publish');

    // Handle scheduled posts (only when publishing, not saving as draft)
    if (!asDraft && scheduleConfig.enabled && scheduleConfig.scheduledFor) {
      try {
        const dTag = editingPost?.d || `blog-${Date.now()}`;
        const scheduledFor = scheduleConfig.scheduledFor;
        const created_at = Math.floor(scheduledFor.getTime() / 1000);

        const tags = [
          ['d', dTag],
          ['title', formData.title],
          ['published', 'true'],
          ['published_at', created_at.toString()],
          ...(formData.coverImage ? [['image', formData.coverImage] as string[]] : []),
        ];

        // Create and sign the event with future timestamp
        const signedEvent = await user.signer.signEvent({
          kind: 30023,
          content: formData.content,
          tags,
          created_at,
        }) as NostrEvent;

        const relaysToUse = selectedRelays.length > 0 ? selectedRelays : initialPublishRelays;

        // Update existing scheduled post or create new one
        if (editingScheduledPostId) {
          await updateScheduledPost({
            id: editingScheduledPostId,
            userPubkey: user.pubkey,
            updates: {
              signed_event: signedEvent,
              scheduled_for: scheduledFor.toISOString(),
              relays: relaysToUse,
            },
          });

          toast({
            title: 'Scheduled Post Updated',
            description: `Your scheduled blog post has been updated for ${scheduledFor.toLocaleString()}`,
          });
        } else {
          // Store in InsForge for scheduled publishing
          await createScheduledPost({
            signedEvent,
            kind: 30023,
            scheduledFor: scheduledFor,
            relays: relaysToUse,
            userPubkey: user.pubkey,
          });

          // If we were editing a private draft, delete it
          if (editingPost && editingPost.kind === 31234) {
            await publishEvent({
              event: {
                kind: 5,
                tags: [
                  ['e', editingPost.id],
                  ['a', `31234:${user.pubkey}:${editingPost.d}`]
                ],
              },
              relays: selectedRelays,
            });
          }

          toast({
            title: 'Post Scheduled',
            description: `Your blog post will be published at ${scheduledFor.toLocaleString()}`,
          });
        }

        setFormData({ title: '', content: '', published: false, coverImage: '' });
        setIsCreating(false);
        setEditingPost(null);
        setEditingScheduledPostId(null);
        setScheduleConfig({ enabled: false, scheduledFor: null });
        setPendingAction(null);
        refetch();
        return;
      } catch (error) {
        console.error('Failed to schedule post:', error);
        setPendingAction(null);
        toast({
          title: 'Error',
          description: (error as Error).message || 'Failed to schedule post.',
          variant: 'destructive',
        });
        return;
      }
    }

    // Normal publish or draft save
    try {
      const dTag = editingPost?.d || `blog-${Date.now()}`;
      const tags = [
        ['d', dTag],
        ['title', formData.title],
        ['published', (!asDraft).toString()],
        ...(formData.coverImage ? [['image', formData.coverImage] as string[]] : []),
      ];

      if (!asDraft) {
        // Publish as Kind 30023 (Long-form Content)
        await publishEvent({
          event: {
            kind: 30023,
            content: formData.content,
            tags: [
              ...tags,
              ['published_at', Math.floor(Date.now() / 1000).toString()]
            ],
          },
          relays: selectedRelays,
        });

        // If we were editing a private draft, delete it
        if (editingPost && editingPost.kind === 31234) {
          await publishEvent({
            event: {
              kind: 5,
              tags: [
                ['e', editingPost.id],
                ['a', `31234:${user.pubkey}:${editingPost.d}`]
              ],
            },
            relays: selectedRelays,
          });
        }

        toast({ title: "Success", description: "Post published successfully." });
      } else {
        // Save as Kind 31234 (NIP-37 Draft Wrap) for privacy
        const draftEvent = {
          kind: 30023,
          content: formData.content,
          tags,
          created_at: Math.floor(Date.now() / 1000),
        };

        let encryptedContent: string;
        if (user.signer.nip44) {
          encryptedContent = await user.signer.nip44.encrypt(user.pubkey, JSON.stringify(draftEvent));
        } else if (user.signer.nip04) {
          encryptedContent = await user.signer.nip04.encrypt(user.pubkey, JSON.stringify(draftEvent));
        } else {
          encryptedContent = JSON.stringify(draftEvent);
        }

        await publishEvent({
          event: {
            kind: 31234,
            content: encryptedContent,
            tags: [
              ['d', dTag],
              ['k', '30023'],
            ],
          },
          relays: selectedRelays,
        });

        // If we were editing a published post, delete it
        if (editingPost && editingPost.kind === 30023) {
          await publishEvent({
            event: {
              kind: 5,
              tags: [
                ['e', editingPost.id],
                ['a', `30023:${user.pubkey}:${editingPost.d}`]
              ],
            },
            relays: selectedRelays,
          });
        }

        toast({ title: "Success", description: "Draft saved privately." });
      }

      // Reset form
      setFormData({ title: '', content: '', published: false, coverImage: '' });
      setIsCreating(false);
      setEditingPost(null);
      setScheduleConfig({ enabled: false, scheduledFor: null });
      setPendingAction(null);
      refetch();
    } catch (error: unknown) {
      console.error('Submit failed:', error);
      setPendingAction(null);
      const errorMessage = error instanceof Error ? error.message : "Failed to save post.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  const handleEdit = (post: BlogPost) => {
    if (user && post.pubkey !== user.pubkey) {
      toast({
        title: "Error",
        description: "You cannot edit another user's post.",
        variant: "destructive"
      });
      return;
    }
    setFormData({
      title: post.title,
      content: post.content,
      published: post.published,
      coverImage: post.image || '',
    });
    setEditingPost(post);
    setIsCreating(true);
    setScheduleConfig({ enabled: false, scheduledFor: null });
    window.scrollTo(0, 0);
  };

  const handleDelete = async (post: BlogPost) => {
    if (user && post.pubkey !== user.pubkey) {
      toast({
        title: "Error",
        description: "You cannot delete another user's post.",
        variant: "destructive"
      });
      return;
    }
    try {
      await publishEvent({
        event: {
          kind: 5,
          tags: [
            ['e', post.id],
            ['a', `${post.kind}:${post.pubkey}:${post.d}`]
          ],
        },
        relays: selectedRelays,
      });
      toast({ title: "Success", description: "Post deleted successfully." });
      setDeleteTarget(null);
      refetch();
    } catch (error: unknown) {
      console.error('Delete failed:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to delete post.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  return (
    <div className="space-y-6">
      {isCreating ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">
              {editingScheduledPostId ? 'Edit Scheduled Post' : editingPost ? 'Edit Post' : 'Create New Post'}
            </h2>
            <Button variant="outline" onClick={handleCancel}>
              Back to List
            </Button>
          </div>

          <Card>
            <CardContent className="pt-6">
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                {/* Cover Image */}
                <div>
                  <Label>Cover Image</Label>
                  {formData.coverImage ? (
                    <div className="relative mt-2 rounded-lg overflow-hidden border group">
                      <img src={formData.coverImage} alt="Cover preview" className="w-full h-40 object-cover" />
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="absolute top-2 right-2 h-8 w-8 p-0 opacity-90"
                        onClick={() => setFormData(prev => ({ ...prev, coverImage: '' }))}
                        title="Remove cover image"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 w-full h-32 border-dashed flex flex-col items-center justify-center gap-2 text-muted-foreground"
                      onClick={() => setShowCoverImageSelector(true)}
                    >
                      <ImageIcon className="h-8 w-8" />
                      <span className="text-sm">Choose cover image</span>
                    </Button>
                  )}
                </div>

                <MediaSelectorDialog
                  open={showCoverImageSelector}
                  onOpenChange={setShowCoverImageSelector}
                  onSelect={(url) => {
                    setFormData(prev => ({ ...prev, coverImage: url }));
                    setShowCoverImageSelector(false);
                  }}
                  title="Choose Cover Image"
                />

                <div>
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter post title..."
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="content">Content</Label>
                  <Tabs defaultValue="edit" className="mt-2">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="edit">
                        <Layout className="h-4 w-4 mr-2" />
                        Edit
                      </TabsTrigger>
                      <TabsTrigger value="preview">
                        <Eye className="h-4 w-4 mr-2" />
                        Preview
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="edit" className="mt-2">
                      <MarkdownToolbar textareaId="blog-content" disabled={!!pendingAction || isUploading} />
                      {isUploading && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Uploading media...
                        </div>
                      )}
                      <Textarea
                        id="blog-content"
                        ref={textareaRef}
                        value={formData.content}
                        onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                        onPaste={handlePaste}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        placeholder="Write your post in Markdown..."
                        className="min-h-[300px] font-mono"
                        required
                      />
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*,video/*"
                        multiple
                        onChange={handleManualUpload}
                      />
                    </TabsContent>
                    <TabsContent value="preview" className="mt-2">
                      <div className="min-h-[300px] p-4 border rounded-md prose prose-sm dark:prose-invert max-w-none bg-white dark:bg-slate-950 overflow-auto">
                        {formData.coverImage && (
                          <img src={formData.coverImage} alt={formData.title} className="w-full h-auto max-h-[300px] object-contain rounded-lg mb-6" />
                        )}
                        {formData.title && (
                          <h1 className="text-3xl font-bold tracking-tight mb-4">{formData.title}</h1>
                        )}
                        <PageContent content={formData.content || '*Nothing to preview*'} />
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Schedule Picker */}
                {isSchedulerHealthy && (
                  <SchedulePicker
                    value={scheduleConfig}
                    onChange={(config) => {
                      setScheduleConfig(config);
                    }}
                    disabled={!!pendingAction}
                  />
                )}

                {/* Publishing Relays — collapsed under Advanced */}
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors pt-2">
                    <Share2 className="h-4 w-4" />
                    Advanced: Publishing Relays
                    <ChevronDown className="h-4 w-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {initialPublishRelays.map((relay) => (
                        <div key={relay} className="flex items-center space-x-2 bg-muted/30 p-2 rounded-md border">
                          <Checkbox
                            id={`relay-${relay}`}
                            checked={selectedRelays.includes(relay)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedRelays(prev => [...prev, relay]);
                              } else {
                                setSelectedRelays(prev => prev.filter(r => r !== relay));
                              }
                            }}
                          />
                          <label
                            htmlFor={`relay-${relay}`}
                            className="text-xs font-mono truncate cursor-pointer flex-1"
                            title={relay}
                          >
                            {relay.replace('wss://', '').replace('ws://', '')}
                          </label>
                        </div>
                      ))}
                      {initialPublishRelays.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No publishing relays configured.</p>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={!!pendingAction}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleSubmit(true)}
                    disabled={!!pendingAction || !formData.title.trim() || !formData.content.trim()}
                    className={pendingAction === 'draft' ? 'btn-loading-snake' : ''}
                  >
                    Save Draft
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleSubmit(false)}
                    disabled={!!pendingAction || !formData.title.trim() || !formData.content.trim()}
                    className={pendingAction === 'publish' ? 'btn-loading-snake' : ''}
                  >
                    {scheduleConfig.enabled ? (
                      <>
                        <Clock className="h-4 w-4 mr-2" />
                        {editingScheduledPostId ? 'Update Scheduled Post' : 'Schedule Post'}
                      </>
                    ) : editingPost ? 'Update Post' : 'Publish Post'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <div className="space-y-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Blog Posts</h2>
              <p className="text-muted-foreground">
                Manage your blog posts and long-form content.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by title or content..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button onClick={() => setIsCreating(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Post
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="filter-nostr-json-blog"
                checked={filterByNostrJson}
                onCheckedChange={setFilterByNostrJson}
              />
              <Label htmlFor="filter-nostr-json-blog" className="text-sm cursor-pointer flex items-center gap-2">
                <Filter className="h-3 w-3" />
                Show only users from nostr.json
              </Label>
            </div>

            <BlogVisibilityCard />
          </div>

          <div className="space-y-4">
            <Tabs value={postTab} onValueChange={(v) => setPostTab(v as 'published' | 'drafts')}>
              <TabsList className="grid w-full grid-cols-2 sm:w-fit">
                <TabsTrigger value="published">
                  Published ({publishedPosts.length})
                </TabsTrigger>
                <TabsTrigger value="drafts">
                  Drafts ({draftPosts.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {tabbedPosts.map((post) => (
              <BlogPostCard
                key={post.id}
                post={post}
                user={user}
                searchQuery={searchQuery}
                onEdit={handleEdit}
                onDelete={setDeleteTarget}
                relayUrl={defaultRelayUrl || ''}
                publishRelays={initialPublishRelays}
              />
            ))}

            {tabbedPosts.length === 0 && (
              <Card>
                <CardContent className="pt-6 text-center">
                  <p className="text-muted-foreground">
                    {postTab === 'published'
                      ? 'No published posts yet. Publish a draft or create a new post!'
                      : 'No drafts. Create a new post and save it as a draft.'}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Styled delete dialog */}
          <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete post?</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete <strong>{deleteTarget?.title}</strong>? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-row gap-2 sm:justify-end">
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={() => deleteTarget && handleDelete(deleteTarget)}
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}