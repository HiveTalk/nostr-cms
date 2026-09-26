/**
 * AdminScheduledPage - Manage scheduled posts
 *
 * View, delete, and monitor scheduled Kind 1 notes and Kind 30023 blog posts
 */

import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNavigate } from 'react-router-dom';
import {
  useScheduledPosts,
  useScheduledPostsStats,
  useDeleteScheduledPost,
  useClearScheduledPostsHistory,
  useRetryScheduledPost,
  getTimeRemaining,
} from '@/hooks/useScheduledPosts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { NoteContent } from '@/components/NoteContent';
import { toast } from '@/hooks/useToast';
import { useSchedulerHealth } from '@/hooks/useSchedulerHealth';
import {
  Clock,
  Calendar,
  CheckCircle,
  XCircle,
  Trash2,
  FileText,
  FileCode,
  Loader2,
  Edit2,
  AlertCircle,
  Repeat,
  RotateCcw,
} from 'lucide-react';
import { format } from 'date-fns';
import type { NostrEvent } from '@nostrify/nostrify';
import type { ScheduledPost } from '@/types/scheduled';
import {
  getScheduledPostKind,
  getScheduledPostPreview,
  getScheduledPostRepostKindLabel,
  getScheduledPostImage,
} from '@/lib/scheduledPostPreview';
import { CalendarGrid, type CalendarItem } from '@/components/admin/CalendarGrid';
import { SchedulePicker, type ScheduleConfig } from '@/components/admin/SchedulePicker';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface ScheduledPostCardProps {
  post: ScheduledPost;
  onDelete: (id: string) => void;
  onEdit: (post: ScheduledPost) => void;
  onRetry: (post: ScheduledPost) => void;
}

function ScheduledPostCard({ post, onDelete, onEdit, onRetry }: ScheduledPostCardProps) {
  const timeRemaining = getTimeRemaining(post.scheduled_for);
  const isNote = post.kind === 1;
  const isBlog = post.kind === 30023;
  const isRepost = post.kind === 6 || post.kind === 16;

  // Extract repeat metadata from the signed event's tags
  const repeatTotal = post.signed_event.tags?.find(([t]) => t === 'repeat_total')?.[1];
  const repeatIndex = post.signed_event.tags?.find(([t]) => t === 'repeat_index')?.[1];
  const repeatInterval = post.signed_event.tags?.find(([t]) => t === 'repeat_interval')?.[1];
  const hasRepeat = repeatTotal && repeatIndex && repeatInterval && Number(repeatTotal) > 1;

  // "ends" means the latest scheduled publication in the series. Derive the
  // original series end from the signed event's created_at (immutable — a
  // retry changes scheduled_for but not the signed event), then clamp to
  // this entry's scheduled_for: an entry retried past the original end is
  // itself the last publication, so "ends" should show its new date.
  let repeatEndDate: Date | null = null;
  if (hasRepeat) {
    const remaining = Number(repeatTotal) - Number(repeatIndex) - 1;
    const originalEnd =
      post.signed_event.created_at * 1000 + remaining * Number(repeatInterval) * 1000;
    repeatEndDate = new Date(
      Math.max(originalEnd, new Date(post.scheduled_for).getTime()),
    );
  }

  // Get content preview
  const contentPreview = getScheduledPostPreview(post);
  const repostKindLabel = getScheduledPostRepostKindLabel(post);

  return (
    <Card className={post.status === 'published' ? 'opacity-60' : ''}>
      <CardContent className="pt-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={
                  post.status === 'published'
                    ? 'default'
                    : post.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                }
                className="text-xs"
              >
                {post.status === 'published' && <CheckCircle className="h-3 w-3 mr-1" />}
                {post.status === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
                {post.status === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                {post.status}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono">
                Kind {post.kind}
              </Badge>
              {isNote && (
                <Badge variant="outline" className="text-xs">
                  <FileText className="h-3 w-3 mr-1" />
                  Note
                </Badge>
              )}
              {isBlog && (
                <Badge variant="outline" className="text-xs">
                  <FileCode className="h-3 w-3 mr-1" />
                  Blog Post
                </Badge>
              )}
              {isRepost && (
                <Badge variant="outline" className="text-xs">
                  <Repeat className="h-3 w-3 mr-1" />
                  Repost{repostKindLabel ? ` · ${repostKindLabel}` : ''}
                </Badge>
              )}
            </div>

            <p className="text-sm text-foreground break-words line-clamp-3">{contentPreview}</p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3 shrink-0" />
                {format(new Date(post.scheduled_for), 'MMM d, yyyy · h:mm a')}
              </div>
              {post.status === 'pending' && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3 shrink-0" />
                  {timeRemaining.text}
                </div>
              )}
            </div>

            {hasRepeat && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Repeat className="h-3 w-3 shrink-0" />
                Repeating · {Number(repeatIndex) + 1} of {repeatTotal}
                {repeatEndDate && ` · ends ${format(repeatEndDate, 'MMM d, yyyy')}`}
              </div>
            )}

            {post.status === 'failed' && post.error_message && (
              <p className="text-xs text-destructive break-words">{post.error_message}</p>
            )}

            <div className="text-xs text-muted-foreground break-words">
              Relays: {post.relays.length} · {post.relays[0]?.replace('wss://', '')}
              {post.relays.length > 1 && ` +${post.relays.length - 1}`}
            </div>

            {post.published_at && (
              <p className="text-xs text-muted-foreground break-words">
                Published at {format(new Date(post.published_at), 'MMM d, yyyy · h:mm a')}
              </p>
            )}
          </div>

          <div className="flex gap-1 shrink-0 self-end sm:self-auto">
            {post.status === 'pending' && (
              <>
                {!isRepost && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onEdit(post)}
                    title="Edit scheduled post"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(post.id)}
                  title="Delete scheduled post"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {post.status === 'failed' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-primary hover:text-primary"
                  onClick={() => onRetry(post)}
                  title="Retry failed post"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(post.id)}
                  title="Delete failed post"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ScheduledPostCalendarItemData extends CalendarItem {
  post: ScheduledPost;
}

interface ScheduledPostCalendarItemProps {
  item: ScheduledPostCalendarItemData;
  compact: boolean;
  onClick: () => void;
}

function ScheduledPostCalendarItem({
  item,
  compact,
  onClick,
}: ScheduledPostCalendarItemProps): ReactNode {
  const post = item.post;
  const kind = getScheduledPostKind(post);
  const preview = getScheduledPostPreview(post);

  const statusColor =
    post.status === 'published'
      ? 'bg-green-100 text-green-900 border-green-200 hover:bg-green-200'
      : post.status === 'failed'
        ? 'bg-red-100 text-red-900 border-red-200 hover:bg-red-200'
        : 'bg-yellow-100 text-yellow-900 border-yellow-200 hover:bg-yellow-200';

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`cursor-pointer rounded border p-1 text-xs ${statusColor}`}
      >
        <div className="flex items-center gap-1">
          {kind === 'note' && <FileText className="h-3 w-3 shrink-0" />}
          {kind === 'blog' && <FileCode className="h-3 w-3 shrink-0" />}
          {kind === 'repost' && <Repeat className="h-3 w-3 shrink-0" />}
          <span className="truncate">{preview}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded border p-2 text-xs ${statusColor}`}
    >
      <div className="flex items-start gap-2">
        {item.image && (
          <img
            src={item.image}
            alt=""
            className="h-10 w-10 rounded object-cover shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 font-medium">
            {kind === 'note' && <FileText className="h-3 w-3 shrink-0" />}
            {kind === 'blog' && <FileCode className="h-3 w-3 shrink-0" />}
            {kind === 'repost' && <Repeat className="h-3 w-3 shrink-0" />}
            <span className="truncate capitalize">{kind}</span>
            <span className="text-[10px] opacity-70 uppercase">· {post.status}</span>
          </div>
          <p className="line-clamp-2 mt-1">{preview}</p>
          <p className="text-[10px] opacity-70 mt-1">
            {format(new Date(post.scheduled_for), 'h:mm a')}
          </p>
        </div>
      </div>
    </div>
  );
}

interface ScheduledPostPreviewDialogProps {
  post: ScheduledPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (post: ScheduledPost) => void;
  onRetry: (post: ScheduledPost) => void;
}

function ScheduledPostPreviewDialog({
  post,
  open,
  onOpenChange,
  onDelete,
  onEdit,
  onRetry,
}: ScheduledPostPreviewDialogProps) {
  if (!post) return null;

  const kind = getScheduledPostKind(post);
  const scheduledAt = new Date(post.scheduled_for);
  const isEditable = post.status === 'pending' && post.kind !== 6 && post.kind !== 16;

  let contentNode: ReactNode;

  if (kind === 'repost') {
    try {
      const original = JSON.parse(post.signed_event.content) as NostrEvent;
      contentNode = (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Repost of kind {original.kind} note
          </p>
          <NoteContent
            event={{ ...original, sig: original.sig || '' }}
            className="text-sm whitespace-pre-wrap break-words"
          />
        </div>
      );
    } catch {
      contentNode = (
        <p className="text-sm text-muted-foreground">
          {getScheduledPostPreview(post)}
        </p>
      );
    }
  } else if (kind === 'blog') {
    const title = post.signed_event.tags.find(([t]) => t === 'title')?.[1] || 'Untitled';
    const summary = post.signed_event.tags.find(([t]) => t === 'summary')?.[1] || '';
    const image = post.signed_event.tags.find(([t]) => t === 'image')?.[1];
    contentNode = (
      <div className="space-y-4">
        {image && (
          <img
            src={image}
            alt=""
            className="max-w-full max-h-[300px] object-contain rounded-lg border"
          />
        )}
        <div>
          <h3 className="font-semibold">{title}</h3>
          {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
        </div>
        <NoteContent
          event={post.signed_event}
          className="text-sm whitespace-pre-wrap break-words"
        />
      </div>
    );
  } else {
    contentNode = (
      <NoteContent
        event={post.signed_event}
        className="text-sm whitespace-pre-wrap break-words"
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            {kind === 'note' && <FileText className="h-4 w-4" />}
            {kind === 'blog' && <FileCode className="h-4 w-4" />}
            {kind === 'repost' && <Repeat className="h-4 w-4" />}
            <span className="capitalize">{kind}</span>
            <Badge
              variant={
                post.status === 'published'
                  ? 'default'
                  : post.status === 'failed'
                    ? 'destructive'
                    : 'secondary'
              }
              className="text-[10px]"
            >
              {post.status}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Scheduled for {format(scheduledAt, 'MMM d, yyyy · h:mm a')}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 -mr-1 space-y-4">
          {contentNode}
        </div>
        <DialogFooter className="flex flex-row justify-end gap-2 mt-4">
          {post.status === 'failed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onRetry(post);
                onOpenChange(false);
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          )}
          {isEditable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onEdit(post);
                onOpenChange(false);
              }}
            >
              <Edit2 className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(post.id);
              onOpenChange(false);
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RetryScheduledPostDialogProps {
  post: ScheduledPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: (post: ScheduledPost, scheduledFor: Date, freshCopy: boolean) => void;
  isPending?: boolean;
}

function RetryScheduledPostDialog({
  post,
  open,
  onOpenChange,
  onRetry,
  isPending = false,
}: RetryScheduledPostDialogProps) {
  // The parent remounts this dialog via `key` on every open, so this state is
  // always fresh — there is no stale SchedulePicker input or open-time
  // scheduledFor left over from a previous retry session.
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>({
    enabled: true,
    scheduledFor: new Date(),
  });
  const [preserveSignature, setPreserveSignature] = useState(true);
  const signerAvailable =
    typeof window !== 'undefined' &&
    typeof (window as Window & { nostr?: { signEvent?: unknown } }).nostr?.signEvent === 'function';

  if (!post) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Retry Failed Post
          </DialogTitle>
          <DialogDescription>
            Choose when to retry this failed post.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <SchedulePicker value={scheduleConfig} onChange={setScheduleConfig} />

          <div className="flex items-start gap-2">
            <Switch
              id="preserve-signature"
              checked={preserveSignature || !signerAvailable}
              onCheckedChange={setPreserveSignature}
              disabled={!signerAvailable}
            />
            <Label htmlFor="preserve-signature" className="text-xs leading-snug cursor-pointer">
              Keep original signature — publishes the signed event unchanged. The post keeps
              its original timestamp, so it lands at its original position in feeds. Turn off
              to sign a fresh copy stamped with the retry time (requires your signer).
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => {
              // A non-future value means "post now" — send the click time,
              // not the dialog-open time held in scheduleConfig.
              const t = scheduleConfig.scheduledFor;
              onRetry(post, t && t.getTime() > Date.now() ? t : new Date(), !preserveSignature);
              onOpenChange(false);
            }}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Retry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScheduledPostsDayDialogProps {
  date: Date | null;
  items: ScheduledPostCalendarItemData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemClick: (item: ScheduledPostCalendarItemData) => void;
}

function ScheduledPostsDayDialog({
  date,
  items,
  open,
  onOpenChange,
  onItemClick,
}: ScheduledPostsDayDialogProps) {
  if (!date) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{format(date, 'MMMM d, yyyy')}</DialogTitle>
          <DialogDescription>
            {items.length} scheduled post{items.length === 1 ? '' : 's'}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 -mr-1 space-y-2">
          {items.map((item) => (
            <ScheduledPostCalendarItem
              key={item.id}
              item={item}
              compact={false}
              onClick={() => {
                onItemClick(item);
                onOpenChange(false);
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminScheduledPage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { data: scheduledPosts, isLoading } = useScheduledPosts(user?.pubkey);
  const { data: stats } = useScheduledPostsStats(user?.pubkey);
  const { mutateAsync: deletePost } = useDeleteScheduledPost();
  const { mutateAsync: retryPost, isPending: isRetryingPost } = useRetryScheduledPost();
  const { mutateAsync: clearHistory, isPending: isClearingHistory } = useClearScheduledPostsHistory();
  const [activeTab, setActiveTab] = useState<'pending' | 'published' | 'failed' | 'calendar'>('pending');
  const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'week'>('month');
  const [previewPost, setPreviewPost] = useState<ScheduledPost | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [retryPostState, setRetryPost] = useState<ScheduledPost | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  // Remounts the retry dialog per open so its SchedulePicker starts clean.
  const [retrySeq, setRetrySeq] = useState(0);
  const [dayDialogDate, setDayDialogDate] = useState<Date | null>(null);
  const [dayDialogItems, setDayDialogItems] = useState<ScheduledPostCalendarItemData[]>([]);
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const { data: isSchedulerHealthy, isLoading: isHealthLoading } = useSchedulerHealth();

  const handleDelete = async (id: string) => {
    if (!user?.pubkey) return;

    if (!confirm('Are you sure you want to delete this scheduled post?')) {
      return;
    }

    try {
      await deletePost({ id, userPubkey: user.pubkey });
      toast({ title: 'Deleted', description: 'Scheduled post deleted successfully.' });
    } catch (error) {
      console.error('Failed to delete scheduled post:', error);
      toast({
        title: 'Error',
        description: (error as Error).message || 'Failed to delete scheduled post.',
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (post: ScheduledPost) => {
    // Navigate to the appropriate editor with the post data
    const event = post.signed_event;
    const editData = {
      scheduledPostId: post.id,
      kind: post.kind,
      content: event.content || '',
      tags: event.tags || [],
      scheduledFor: post.scheduled_for,
      relays: post.relays,
      title: '',
      dTag: '',
      summary: '',
      image: '',
    };

    // Parse blog-specific data if applicable
    if (post.kind === 30023) {
      editData.title = event.tags?.find(([name]) => name === 'title')?.[1] || '';
      editData.dTag = event.tags?.find(([name]) => name === 'd')?.[1] || '';
      editData.summary = event.tags?.find(([name]) => name === 'summary')?.[1] || '';
      editData.image = event.tags?.find(([name]) => name === 'image')?.[1] || '';
    }

    // Navigate with state
    const targetPath = post.kind === 30023 ? '/admin/blog' : '/admin/notes';
    navigate(targetPath, { state: { editingScheduledPost: editData } });
  };

  const handleCalendarItemClick = (item: ScheduledPostCalendarItemData) => {
    setPreviewPost(item.post);
    setPreviewOpen(true);
  };

  const handleRetryClick = (post: ScheduledPost) => {
    setRetryPost(post);
    setRetrySeq((n) => n + 1);
    setRetryOpen(true);
  };

  const handleRetry = async (post: ScheduledPost, scheduledFor: Date, freshCopy: boolean) => {
    if (!user?.pubkey) return;

    try {
      const result = await retryPost({ post, scheduledFor, freshCopy });
      if (result.cleanupFailed) {
        // The fresh copy was scheduled but the failed original could not be
        // removed — warn so the user deletes it instead of retrying again
        // into a duplicate.
        toast({
          title: 'Scheduled — cleanup needed',
          description:
            'The fresh copy was scheduled, but the failed original could not be removed. Delete the failed entry to avoid a duplicate.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Retry scheduled',
        description: scheduledFor <= new Date()
          ? 'The post will be published on the next scheduler tick.'
          : `The post has been rescheduled for ${format(scheduledFor, 'MMM d, yyyy · h:mm a')}.`,
      });
    } catch (error) {
      console.error('Failed to retry scheduled post:', error);
      toast({
        title: 'Error',
        description: (error as Error).message || 'Failed to retry scheduled post.',
        variant: 'destructive',
      });
    }
  };

  const handleShowMore = (date: Date, items: ScheduledPostCalendarItemData[]) => {
    setDayDialogDate(date);
    setDayDialogItems(items);
    setDayDialogOpen(true);
  };

  const calendarItems = useMemo<ScheduledPostCalendarItemData[]>(() => {
    return (scheduledPosts || [])
      .filter((post) => post.status === 'pending' || post.status === 'published')
      .map((post) => ({
        id: post.id,
        start: Math.floor(new Date(post.scheduled_for).getTime() / 1000),
        title: getScheduledPostPreview(post),
        image: getScheduledPostImage(post),
        status: post.status,
        type: getScheduledPostKind(post),
        post,
      }));
  }, [scheduledPosts]);

  const pendingPosts = scheduledPosts?.filter((post) => post.status === 'pending') || [];
  const publishedPosts = scheduledPosts?.filter((post) => post.status === 'published') || [];
  const failedPosts = scheduledPosts?.filter((post) => post.status === 'failed') || [];
  const filteredPosts = activeTab === 'pending' ? pendingPosts : activeTab === 'published' ? publishedPosts : activeTab === 'failed' ? failedPosts : [];

  const handleClearHistory = async (status: 'published' | 'failed') => {
    if (!user?.pubkey) return;

    const postsToClear = (scheduledPosts || []).filter((post) => post.status === status);
    if (postsToClear.length === 0) {
      return;
    }

    const noun = status === 'published' ? 'published history' : 'failed history';
    const confirmed = confirm(
      `Clear ${postsToClear.length} ${noun} item${postsToClear.length > 1 ? 's' : ''}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await clearHistory({
        ids: postsToClear.map((post) => post.id),
        userPubkey: user.pubkey,
        status,
      });
      toast({
        title: 'History cleared',
        description: `Removed ${postsToClear.length} ${noun} item${postsToClear.length > 1 ? 's' : ''}.`,
      });
    } catch (error) {
      console.error(`Failed to clear ${status} history:`, error);
      toast({
        title: 'Error',
        description: (error as Error).message || `Failed to clear ${status} history.`,
        variant: 'destructive',
      });
    }
  };

  // Check if Scheduler is enabled
  if (isHealthLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (isSchedulerHealthy === false) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <div>
            <h3 className="text-lg font-semibold">Scheduled Posts Not Configured</h3>
            <p className="text-muted-foreground mt-2">
              The scheduler is not enabled. Please check your Swarm Relay configuration.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-muted-foreground">Please log in to manage scheduled posts.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Scheduled Posts</h2>
          <p className="text-muted-foreground">
            Manage your scheduled Kind 1 notes and Kind 30023 blog posts.
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-yellow-500" />
                <span className="text-2xl font-bold">{stats.pending}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Published</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="text-2xl font-bold">{stats.published}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="text-2xl font-bold">{stats.failed}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pending' | 'published' | 'failed' | 'calendar')}>
        <TabsList className="grid w-full grid-cols-4 sm:w-fit">
          <TabsTrigger value="pending">
            Pending
            {stats && stats.pending > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1 text-xs">
                {stats.pending}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="published">
            Published
            {stats && stats.published > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1 text-xs">
                {stats.published}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="failed">
            Failed
            {stats && stats.failed > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1 text-xs">
                {stats.failed}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1">
            <Calendar className="h-3 w-3" />
            Calendar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="pt-6 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : filteredPosts.length > 0 ? (
            filteredPosts.map((post) => (
              <ScheduledPostCard key={post.id} post={post} onDelete={handleDelete} onEdit={handleEdit} onRetry={handleRetryClick} />
            ))
          ) : (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No pending scheduled posts.</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Schedule posts from the Notes or Blog pages.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="published" className="mt-4 space-y-4">
          {publishedPosts.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClearHistory('published')}
                disabled={isClearingHistory}
              >
                {isClearingHistory && activeTab === 'published' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Clear History
              </Button>
            </div>
          )}
          {isLoading ? (
            <Card>
              <CardContent className="pt-6 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : filteredPosts.length > 0 ? (
            filteredPosts.map((post) => (
              <ScheduledPostCard key={post.id} post={post} onDelete={handleDelete} onEdit={handleEdit} onRetry={handleRetryClick} />
            ))
          ) : (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No published scheduled posts yet.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="failed" className="mt-4 space-y-4">
          {failedPosts.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClearHistory('failed')}
                disabled={isClearingHistory}
              >
                {isClearingHistory && activeTab === 'failed' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Clear History
              </Button>
            </div>
          )}
          {isLoading ? (
            <Card>
              <CardContent className="pt-6 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : filteredPosts.length > 0 ? (
            filteredPosts.map((post) => (
              <ScheduledPostCard key={post.id} post={post} onDelete={handleDelete} onEdit={handleEdit} onRetry={handleRetryClick} />
            ))
          ) : (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No failed scheduled posts.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-4 space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="pt-6 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : calendarItems.length > 0 ? (
            <CalendarGrid
              items={calendarItems}
              viewMode={calendarViewMode}
              onViewModeChange={setCalendarViewMode}
              renderItem={({ item, compact, onClick }) => (
                <ScheduledPostCalendarItem
                  item={item as ScheduledPostCalendarItemData}
                  compact={compact}
                  onClick={onClick}
                />
              )}
              onItemClick={handleCalendarItemClick}
              onShowMore={handleShowMore}
            />
          ) : (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-muted-foreground">No pending or published scheduled posts.</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Schedule posts from the Notes or Blog pages.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <ScheduledPostPreviewDialog
        post={previewPost}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onRetry={handleRetryClick}
      />

      <RetryScheduledPostDialog
        key={retrySeq}
        post={retryPostState}
        open={retryOpen}
        onOpenChange={setRetryOpen}
        onRetry={handleRetry}
        isPending={isRetryingPost}
      />

      <ScheduledPostsDayDialog
        date={dayDialogDate}
        items={dayDialogItems}
        open={dayDialogOpen}
        onOpenChange={setDayDialogOpen}
        onItemClick={handleCalendarItemClick}
      />
    </div>
  );
}
