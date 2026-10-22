import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAdminAuth, useRemoteNostrJson } from '@/hooks/useRemoteNostrJson';
import { useToast } from '@/hooks/useToast';
import { useBlossomRelays } from '@/hooks/useBlossomRelays';
import {
  Server,
  Search,
  Upload,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  FileImage,
  FileVideo,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  Loader2,
  Play,
  List,
  LayoutGrid,
  Columns3,
  RefreshCw,
  Download,
  XCircle,
  CheckCircle2,
  SkipForward,
  Radio,
  Clock,
  CalendarIcon
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn, formatPubkey } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NRelay1, type NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { DateRange } from 'react-day-picker';
import { getSiteConfigDTag, getMasterPubkey, getDefaultRelayUrl } from '@/lib/relay';
import {
  stripImageMetadata,
  processImage,
  processVideo,
  streamProcessVideo,
  uploadMediaFile,
  mediaMimeType,
  estimateVideoSize,
  formatBytes,
  type VideoQuality,
  type VideoResolution,
  type VideoProcessResult,
} from '@/lib/mediaProcessing';
import { type BlossomBlob, urlWithExtension, getMediaPreviewKind } from '@/lib/blossom';
import { useMasonry } from '@/hooks/useMasonry';
import { useFileDropzone } from '@/hooks/useFileDropzone';

// --- Types ---

const PAGE_SIZE = 60;
const MASONRY_CONFIG = { columns: { base: 2, md: 3, lg: 4 }, gap: 16 };

// --- Components ---

/**
 * Section 1: Manage Servers
 */
function ManageServersSection() {
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { mutateAsync: publish, isPending: isPublishing } = useNostrPublish();
  const [newServer, setNewServer] = useState('');

  // Stored relays from config
  const storedBlossomRelays = useMemo(() => config.siteConfig?.blossomRelays || [], [config.siteConfig?.blossomRelays]);

  // Effective relays including derived default relay
  const blossomRelays = useBlossomRelays();

  const handleAddServer = () => {
    if (!newServer) return;
    let url = newServer.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    // Remove trailing slash
    url = url.replace(/\/$/, '');

    if (blossomRelays.includes(url)) {
      toast({ title: "Error", description: "Server already exists", variant: "destructive" });
      return;
    }

    updateConfig((prev) => {
      const excluded = prev.siteConfig?.excludedBlossomRelays || [];
      const newExcluded = excluded.filter(r => r !== url);

      return {
        ...prev,
        siteConfig: {
          ...prev.siteConfig,
          blossomRelays: [...storedBlossomRelays, url],
          excludedBlossomRelays: newExcluded.length > 0 ? newExcluded : undefined
        }
      };
    });
    setNewServer('');
    toast({ title: "Success", description: "Server added" });
  };

  const handleRemoveServer = (url: string) => {
    const isStored = storedBlossomRelays.includes(url);

    updateConfig((prev) => {
      const newStored = (prev.siteConfig?.blossomRelays || []).filter(r => r !== url);
      const newExcluded = [...(prev.siteConfig?.excludedBlossomRelays || [])];

      if (!isStored) {
        // If it wasn't stored, it must be the default relay, so we exclude it
        if (!newExcluded.includes(url)) {
          newExcluded.push(url);
        }
      }

      return {
        ...prev,
        siteConfig: {
          ...prev.siteConfig,
          blossomRelays: newStored,
          excludedBlossomRelays: newExcluded.length > 0 ? newExcluded : undefined
        }
      };
    });
    toast({ title: "Success", description: "Server removed" });
  };

  const moveServer = (index: number, direction: 'up' | 'down') => {
    const newRelays = [...storedBlossomRelays];
    // This is tricky because the UI shows blossomRelays (derived), but we update storedBlossomRelays
    // If the item being moved is the derived one, we might need to handle it differently or just disable moving for derived items
    const relayToMove = blossomRelays[index];
    const isStored = storedBlossomRelays.includes(relayToMove);

    if (!isStored) {
      toast({ title: "Info", description: "Default relay position cannot be changed manually" });
      return;
    }

    const storedIndex = storedBlossomRelays.indexOf(relayToMove);
    const targetStoredIndex = direction === 'up' ? storedIndex - 1 : storedIndex + 1;

    if (targetStoredIndex < 0 || targetStoredIndex >= newRelays.length) return;

    [newRelays[storedIndex], newRelays[targetStoredIndex]] = [newRelays[targetStoredIndex], newRelays[storedIndex]];

    updateConfig((prev) => ({
      ...prev,
      siteConfig: {
        ...prev.siteConfig,
        blossomRelays: newRelays
      }
    }));
  };

  // Query existing kind 10063 for this user
  const { data: existingServerList, refetch: refetchServerList } = useQuery({
    queryKey: ['kind-10063', user?.pubkey],
    queryFn: async () => {
      if (!user?.pubkey) return null;
      const defaultRelay = config.siteConfig?.defaultRelay;
      if (!defaultRelay) return null;
      const relay = new NRelay1(defaultRelay);
      const events = await relay.query(
        [{ kinds: [10063], authors: [user.pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(5000) }
      );
      return events[0] ?? null;
    },
    enabled: !!user?.pubkey,
  });

  const publishedServers = existingServerList
    ? existingServerList.tags.filter(t => t[0] === 'server').map(t => t[1])
    : null;

  const listIsUpToDate = publishedServers !== null &&
    blossomRelays.length === publishedServers.length &&
    blossomRelays.every(r => publishedServers.includes(r));

  const handlePublishServerList = async () => {
    if (!user || blossomRelays.length === 0) return;
    const defaultRelay = config.siteConfig?.defaultRelay;
    try {
      await publish({
        event: {
          kind: 10063,
          content: '',
          tags: blossomRelays.map(url => ['server', url]),
        },
        relays: defaultRelay ? [defaultRelay] : undefined,
      });
      toast({ title: 'Server list published', description: 'Kind 10063 event published to your relay. Clients that support BUD-03 will now fall back to your Blossom server if media links break.' });
      refetchServerList();
    } catch (e) {
      toast({ title: 'Publish failed', description: String(e), variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Servers</CardTitle>
        <CardDescription>Configure Blossom servers for media storage and delivery.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {blossomRelays.map((url, index) => (
            <div key={url} className="flex items-center justify-between p-3 border rounded-lg bg-card flex-wrap gap-2">
              <div className="flex items-center gap-3 overflow-hidden">
                <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate">{url}</span>
                <Badge variant="secondary" className="text-[10px] uppercase">blossom</Badge>
                {!storedBlossomRelays.includes(url) && <Badge variant="outline" className="text-[10px] uppercase">default</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveServer(index, 'up')} disabled={index === 0 || !storedBlossomRelays.includes(url)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveServer(index, 'down')} disabled={index === blossomRelays.length - 1 || !storedBlossomRelays.includes(url)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveServer(url)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          {blossomRelays.length === 0 && (
            <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg">
              No Blossom servers configured.
            </div>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="https://blossom.example.com"
            value={newServer}
            onChange={(e) => setNewServer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddServer()}
          />
          <Button onClick={handleAddServer}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>

        {/* BUD-03: Publish kind 10063 server list */}
        <div className="mt-6 space-y-3 border-t pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                Blossom Server List (kind 10063)
              </p>
              <p className="text-xs text-muted-foreground">
                Publishes your server list as a signed Nostr event (BUD-03). Clients that support
                it will automatically fall back to your Blossom server if a media link breaks —
                as long as the original URL contains the file's sha256 hash.
              </p>
            </div>
          </div>

          {/* Current published state */}
          {publishedServers !== null && (
            <div className={cn(
              'flex items-start gap-2 text-xs p-3 rounded-lg border',
              listIsUpToDate
                ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
            )}>
              {listIsUpToDate
                ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              <div className="space-y-0.5">
                {listIsUpToDate
                  ? <p>Published list is up to date.</p>
                  : <p>Published list is out of sync with your current servers.</p>}
                <p className="text-[10px] opacity-70 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last published: {new Date(existingServerList!.created_at * 1000).toLocaleString()}
                  {' · '}{publishedServers.length} server{publishedServers.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}

          {publishedServers === null && !!user && (
            <div className="flex items-center gap-2 text-xs p-3 rounded-lg border bg-muted/40 text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              No kind 10063 found on your relay yet.
            </div>
          )}

          <Button
            onClick={handlePublishServerList}
            disabled={isPublishing || !user || blossomRelays.length === 0 || listIsUpToDate}
            variant={listIsUpToDate ? 'outline' : 'default'}
            size="sm"
            className="gap-2"
          >
            {isPublishing
              ? <><Loader2 className="h-4 w-4 animate-spin" />Publishing...</>
              : listIsUpToDate
                ? <><CheckCircle2 className="h-4 w-4" />Published &amp; up to date</>
                : <><Radio className="h-4 w-4" />Publish Server List</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Section 2: Browse Media
 */
function BrowseMediaSection() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { isMaster } = useAdminAuth(user?.pubkey);
  const { data: nostrJson } = useRemoteNostrJson();
  const adminRoles = config.siteConfig?.adminRoles || {};
  const userRole = user?.pubkey ? adminRoles[user.pubkey.toLowerCase().trim()] : undefined;
  const canDelete = isMaster || userRole === 'publisher';

  // Build a pubkey → name lookup from nostr.json for display
  const pubkeyToName = useMemo(() => {
    const map: Record<string, string> = {};
    if (nostrJson?.names) {
      for (const [name, pubkey] of Object.entries(nostrJson.names)) {
        map[pubkey.toLowerCase().trim()] = name;
      }
    }
    return map;
  }, [nostrJson]);

  const displayName = (pubkey: string) => {
    const name = pubkeyToName[pubkey.toLowerCase().trim()];
    if (name && name !== '_') return name;
    return formatPubkey(pubkey).slice(0, 12) + '…';
  };
  const blossomRelays = useBlossomRelays();

  const [selectedRelay, setSelectedRelay] = useState<string>('');

  useEffect(() => {
    if (!selectedRelay && blossomRelays.length > 0) {
      setSelectedRelay(blossomRelays[0]);
    }
  }, [blossomRelays, selectedRelay]);
  const [viewMode, setViewMode] = useState<'masonry' | 'grid' | 'list'>('masonry');
  const [mediaType, setMediaType] = useState<'all' | 'image' | 'video'>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [failedPreviewUrls, setFailedPreviewUrls] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  // Reset page when filter or relay changes
  useEffect(() => { setPage(0); }, [mediaType, selectedRelay, ownerFilter]);

  const isPreviewFailed = (url: string) => failedPreviewUrls.has(url);
  const markPreviewFailed = (url: string) => {
    setFailedPreviewUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };

  const { data: blobs, isLoading, error, refetch } = useQuery({
    queryKey: ['blossom-blobs', selectedRelay, user?.pubkey],
    queryFn: async () => {
      if (!selectedRelay || !user?.pubkey) return [];

      const headers: Record<string, string> = {};

      // Skip signing for the local relay — it doesn't require auth for /list/
      // and the signing prompt can take 15+ seconds with browser extensions.
      const isLocalRelay = selectedRelay.includes('localhost') || selectedRelay.includes('127.0.0.1');

      if (user.signer && !isLocalRelay) {
        try {
          const authEvent = await user.signer.signEvent({
            kind: 24242, // Blossom List
            content: 'List my blobs',
            tags: [
              ['t', 'list'],
            ],
            created_at: Math.floor(Date.now() / 1000),
          });
          const authBase64 = btoa(JSON.stringify(authEvent));
          headers['Authorization'] = `Nostr ${authBase64}`;
        } catch (e) {
          // Some signers (e.g. browser-extension signer without extension installed)
          // are expected to fail here. Continue without auth header.
          if (!(e instanceof Error) || !/browser extension not available/i.test(e.message)) {
            console.warn('Failed to sign Blossom list event:', e);
          }
        }
      }

      const response = await fetch(`${selectedRelay}/list/${user.pubkey}`, { headers });
      if (!response.ok) throw new Error('Failed to fetch blobs');
      return (await response.json()) as BlossomBlob[];
    },
    enabled: !!selectedRelay && !!user?.pubkey
  });

  // Build list of unique owners from blobs for the filter dropdown
  const ownerOptions = useMemo(() => {
    const owners = new Map<string, number>(); // pubkey → blob count
    for (const blob of blobs || []) {
      if (blob.owner) {
        owners.set(blob.owner, (owners.get(blob.owner) || 0) + 1);
      }
    }
    return [...owners.entries()].sort((a, b) => b[1] - a[1]);
  }, [blobs]);

  const filteredBlobs = useMemo(() => {
    const filtered = blobs?.filter(blob => {
      const isMedia = blob.type?.startsWith('image/') || blob.type?.startsWith('video/');
      if (!isMedia) return false;
      if (mediaType === 'image' && !blob.type?.startsWith('image/')) return false;
      if (mediaType === 'video' && !blob.type?.startsWith('video/')) return false;
      if (ownerFilter !== 'all' && blob.owner !== ownerFilter) return false;
      return true;
    }) || [];

    // Sort by date (newest first)
    return [...filtered].sort((a, b) => (b.uploaded || 0) - (a.uploaded || 0));
  }, [blobs, mediaType, ownerFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredBlobs.length / PAGE_SIZE);
  const pagedBlobs = filteredBlobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Masonry layout
  const masonryRef = useRef<HTMLDivElement | null>(null);
  const { positions: masonryPositions, height: masonryHeight } = useMasonry(
    pagedBlobs,
    masonryRef,
    MASONRY_CONFIG,
    [page, viewMode, filteredBlobs.length, mediaType]
  );

  const paginationControls = totalPages > 1 && (
    <div className="flex items-center justify-between pt-4">
      <p className="text-xs text-muted-foreground">
        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredBlobs.length)} of {filteredBlobs.length}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setPage(p => Math.max(0, p - 1)); window.scrollTo(0, 0); }}
          disabled={page === 0}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground font-mono">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setPage(p => Math.min(totalPages - 1, p + 1)); window.scrollTo(0, 0); }}
          disabled={page >= totalPages - 1}
        >
          Next
        </Button>
      </div>
    </div>
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Link copied to clipboard" });
  };

  const handleDeleteBlob = async (blob: BlossomBlob) => {
    if (!user || !selectedRelay) return;
    if (!confirm(`Delete this blob?\n\n${blob.sha256.slice(0, 24)}...\n${blob.type}\n${blob.size > 1024 * 1024 ? (blob.size / 1024 / 1024).toFixed(1) + ' MB' : (blob.size / 1024).toFixed(1) + ' KB'}\n\nThis cannot be undone.`)) return;

    try {
      // Sign a kind 24242 delete auth event (BUD-04)
      const now = Math.floor(Date.now() / 1000);
      const authEvent = await user.signer.signEvent({
        kind: 24242,
        content: 'Delete blob',
        created_at: now,
        tags: [
          ['t', 'delete'],
          ['x', blob.sha256],
          ['expiration', (now + 60).toString()],
        ],
      });
      const authorization = `Nostr ${btoa(JSON.stringify(authEvent))}`;

      const res = await fetch(`${selectedRelay}/${blob.sha256}`, {
        method: 'DELETE',
        headers: { 'Authorization': authorization },
      });

      if (res.ok) {
        toast({ title: 'Blob deleted', description: `${blob.sha256.slice(0, 16)}... removed` });
        refetch();
      } else {
        const reason = res.headers.get('X-Reason') || await res.text();
        toast({ title: 'Delete failed', description: reason, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Delete failed', description: String(e), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Browse Media</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'masonry' ? 'default' : 'outline'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('masonry')}
                title="Masonry view"
              >
                <Columns3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('grid')}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('list')}
                title="List view"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 ml-2"
                onClick={() => {
                  // Clear failed-preview cache so thumbnails get retried;
                  // refetch() alone won't re-render the <img>/<video> tags
                  // because the blob list (and thus React keys) is unchanged.
                  setFailedPreviewUrls(new Set());
                  refetch();
                }}
                disabled={isLoading}
                title="Refresh media"
              >
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {blossomRelays.map(relay => (
              <Button
                key={relay}
                variant={selectedRelay === relay ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedRelay(relay)}
              >
                {relay.replace('https://', '')}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all" onValueChange={(v) => setMediaType(v as 'all' | 'image' | 'video')}>
            <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="image">Images</TabsTrigger>
                <TabsTrigger value="video">Videos</TabsTrigger>
              </TabsList>
              {ownerOptions.length > 0 && (
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    {ownerOptions.map(([pubkey, count]) => {
                      return (
                        <SelectItem key={pubkey} value={pubkey}>
                          {displayName(pubkey)} ({count})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading media from {selectedRelay}...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4 text-destructive">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm font-medium">Error loading media: {(error as Error).message}</p>
              </div>
            ) : filteredBlobs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
                No {mediaType !== 'all' ? mediaType : ''} media found on this server.
              </div>
            ) : viewMode === 'masonry' ? (
              <>
              <div ref={masonryRef} className="relative" style={{ height: masonryHeight || undefined }}>
                {pagedBlobs.map((blob, index) => {
                  const shouldTryPreview = !isPreviewFailed(blob.url);
                  const kind = getMediaPreviewKind(blob);
                  const pos = masonryPositions[index];

                  return <div
                    key={blob.sha256}
                    data-masonry-item
                    className="group absolute rounded-lg border bg-muted overflow-hidden"
                    style={pos ? { left: pos.x, top: pos.y, width: pos.width } : { visibility: 'hidden' }}
                  >
                    {kind === 'image' && shouldTryPreview ? (
                      <img src={blob.url} alt="" loading="lazy" className="block w-full h-auto" onError={() => markPreviewFailed(blob.url)} />
                    ) : kind === 'video' && shouldTryPreview ? (
                      <div className="relative w-full bg-black">
                        <Play className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-white/50 z-10" />
                        <video src={urlWithExtension(blob) + '#t=0.1'} preload="metadata" playsInline muted className="block w-full h-auto opacity-50" onError={() => markPreviewFailed(blob.url)} />
                      </div>
                    ) : (
                      <div className="w-full aspect-video flex items-center justify-center">
                        <FileImage className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                      <Button variant="secondary" size="sm" className="w-full" onClick={() => copyToClipboard(blob.url)}>
                        <Copy className="h-3 w-3 mr-2" />
                        Copy Link
                      </Button>
                      <Button variant="secondary" size="sm" className="w-full" asChild>
                        <a href={blob.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3 mr-2" />
                          Open
                        </a>
                      </Button>
                      <div className="text-[10px] text-white/70 font-mono space-y-1 text-center w-full">
                        <div className="truncate px-1">{blob.sha256.slice(0, 12)}...</div>
                        <div>{(blob.size / 1024).toFixed(1)} KB</div>
                        {blob.uploaded && (
                          <div>{new Date(blob.uploaded * 1000).toISOString().split('T')[0]}</div>
                        )}
                      </div>
                    </div>
                  </div>;
                })}
              </div>
              {paginationControls}
              </>
            ) : viewMode === 'grid' ? (
              <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {pagedBlobs.map((blob, _index) => {
                  const shouldTryPreview = !isPreviewFailed(blob.url);

                  return <div key={blob.sha256} className="group relative aspect-square rounded-lg border bg-muted overflow-hidden">
                    {getMediaPreviewKind(blob) === 'image' && shouldTryPreview ? (
                      <img src={blob.url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => markPreviewFailed(blob.url)} />
                    ) : getMediaPreviewKind(blob) === 'video' && shouldTryPreview ? (
                      <div className="h-full w-full flex items-center justify-center bg-black">
                        <Play className="h-8 w-8 text-white/50 z-10" />
                        <video src={urlWithExtension(blob) + '#t=0.1'} preload="metadata" playsInline muted className="absolute inset-0 h-full w-full object-cover opacity-30" onError={() => markPreviewFailed(blob.url)} />
                      </div>
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <FileImage className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                      <Button variant="secondary" size="sm" className="w-full" onClick={() => copyToClipboard(blob.url)}>
                        <Copy className="h-3 w-3 mr-2" />
                        Copy Link
                      </Button>
                      <Button variant="secondary" size="sm" className="w-full" asChild>
                        <a href={blob.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3 mr-2" />
                          Open
                        </a>
                      </Button>
                      <div className="text-[10px] text-white/70 font-mono space-y-1 text-center w-full">
                        <div className="truncate px-1">{blob.sha256.slice(0, 12)}...</div>
                        <div>{(blob.size / 1024).toFixed(1)} KB</div>
                        {blob.uploaded && (
                          <div>{new Date(blob.uploaded * 1000).toISOString().split('T')[0]}</div>
                        )}
                      </div>
                    </div>
                  </div>;
                })}
              </div>
              {paginationControls}
              </>
            ) : viewMode === 'list' ? (
              <>
              <div className="space-y-1">
                {/* Header for list view */}
                <div className="flex items-center px-4 py-2 text-xs font-medium text-muted-foreground border-b mb-2">
                  <div className="flex-1">Hash</div>
                  <div className="w-40 text-right">Owner</div>
                  <div className="w-24 text-right">Size</div>
                  <div className="w-28 text-right">Date</div>
                  <div className="w-20 text-right">Actions</div>
                </div>
                {pagedBlobs.map((blob, _index) => {
                  const shouldTryPreview = !isPreviewFailed(blob.url);

                  return <div key={blob.sha256} className="flex items-center gap-4 px-4 py-2 hover:bg-muted/50 transition-colors rounded-md group">
                    <div className="flex-1 flex items-center gap-3 overflow-hidden">
                      <div className="h-6 w-6 rounded border bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                        {getMediaPreviewKind(blob) === 'image' && shouldTryPreview ? (
                          <img src={blob.url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => markPreviewFailed(blob.url)} />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            {getMediaPreviewKind(blob) === 'video' && shouldTryPreview ? <FileVideo className="h-3 w-3" /> : <FileImage className="h-3 w-3" />}
                          </div>
                        )}
                      </div>
                      <a
                        href={blob.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-primary hover:underline truncate"
                      >
                        {blob.sha256.slice(0, 16)}...
                      </a>
                    </div>
                    <div className="w-40 text-right text-xs text-muted-foreground truncate">
                      {blob.owner ? displayName(blob.owner) : '—'}
                    </div>
                    <div className="w-24 text-right text-xs text-muted-foreground font-mono">
                      {blob.size > 1024 * 1024
                        ? `${(blob.size / (1024 * 1024)).toFixed(1)} MB`
                        : `${(blob.size / 1024).toFixed(1)} KB`}
                    </div>
                    <div className="w-28 text-right text-xs text-muted-foreground font-mono">
                      {blob.uploaded ? new Date(blob.uploaded * 1000).toISOString().split('T')[0] : '-'}
                    </div>
                    <div className="w-20 text-right flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => copyToClipboard(blob.url)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      {canDelete && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteBlob(blob)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>;
                })}
              </div>
              {paginationControls}
              </>
            ) : null}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Section 3: Upload Media
 */
function UploadMediaSection() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const blossomRelays = useBlossomRelays();

  const [selectedRelays, setSelectedRelays] = useState<string[]>(blossomRelays);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [totalFiles, setTotalFiles] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing options
  const [compressImages, setCompressImages] = useState(false);
  const [imageQuality, setImageQuality] = useState(85);
  const [maxImageDim, setMaxImageDim] = useState(2048);

  // Video streaming transcode option — when enabled, videos are streamed
  // directly to the /process-video-stream endpoint and transcoded on the
  // fly, avoiding the arrayBuffer() memory spike that crashes iOS Safari.
  const [processVideosOnUpload, setProcessVideosOnUpload] = useState(false);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('medium');
  const [videoResolution, setVideoResolution] = useState<VideoResolution>('720');

  // Video processing state
  interface PendingVideo {
    sha256: string;
    url: string;
    originalSize: number;
    originalName: string;
    quality: VideoQuality;
    resolution: VideoResolution;
  }
  const [pendingVideo, setPendingVideo] = useState<PendingVideo | null>(null);
  const [videoResult, setVideoResult] = useState<VideoProcessResult | null>(null);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);

  useEffect(() => {
    setSelectedRelays(blossomRelays);
  }, [blossomRelays]);

  const handleFiles = async (files: FileList) => {
    if (!user || files.length === 0) return;

    if (selectedRelays.length === 0) {
      toast({ title: "Error", description: "Please select at least one relay", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setTotalFiles(files.length);

    const totalFiles = files.length;
    let completedSteps = 0;
    const uploadedVideos: { sha256: string; url: string; size: number; name: string }[] = [];
    const gifWarnings: string[] = [];

    try {
      for (const file of Array.from(files)) {
        // file.type can be empty (e.g. .mkv/.mov/.gif on Linux) — sniff by
        // extension and normalize the File up front so the processors see the
        // real type (a typeless .gif must hit the GIF pass-through, not the
        // canvas, or its animation is flattened to a still frame).
        const sniffed = mediaMimeType(file);
        const isImage = sniffed.startsWith('image/');
        const isVideo = sniffed.startsWith('video/');
        let fileToUpload: File = file.type
          ? file
          : new File([file], file.name, { type: sniffed || 'application/octet-stream' });
        let processedInfo = '';

        // ─── Image processing ───
        if (isImage) {
          setUploadStatus('Stripping metadata...');

          if (compressImages) {
            // Compress + strip metadata (WebP re-encode)
            const result = await processImage(fileToUpload, imageQuality, maxImageDim);
            fileToUpload = result.file;
            if (result.format === 'gif') {
              // TOAST_LIMIT is 1 — accumulate; merged into the final toast below
              gifWarnings.push(`${file.name}: GIF files cannot be metadata-stripped. EXIF/GPS data may be visible.`);
              processedInfo = ' (GIF: uploaded as-is)';
            } else {
              const savings = ((1 - result.processedSize / result.originalSize) * 100).toFixed(0);
              processedInfo = ` → WebP ${formatBytes(result.processedSize)} (-${savings}%)`;
            }
          } else {
            // Strip metadata only (always on for images)
            const stripped = await stripImageMetadata(fileToUpload);
            fileToUpload = stripped.file;
            if (!stripped.stripped) {
              // GIFs can't be stripped — warn user but continue
              processedInfo = stripped.reason === 'gif' ? ' (GIF: metadata not stripped)' : ' (metadata strip failed)';
              if (stripped.reason === 'gif') {
                gifWarnings.push(`${file.name}: GIF files cannot be metadata-stripped. EXIF/GPS data may be visible.`);
              }
            } else if (fileToUpload.size < file.size) {
              processedInfo = ` (metadata stripped: ${formatBytes(file.size)} → ${formatBytes(fileToUpload.size)})`;
            } else {
              processedInfo = ' (metadata stripped)';
            }
          }
        }

        // ─── Video streaming transcode ───
        // When "process videos on upload" is enabled, stream the video
        // directly to /process-video-stream. This avoids the arrayBuffer()
        // memory spike that crashes iOS Safari on large videos, and skips
        // storing the raw original entirely.
        if (isVideo && processVideosOnUpload) {
          setUploadStatus(`Uploading & transcoding ${file.name}...`);

          const result = await streamProcessVideo(
            selectedRelays[0],
            fileToUpload,
            videoQuality,
            videoResolution,
            user.signer,
          );

          // Show the result in the processing panel for accept/reject
          setPendingVideo({
            sha256: result.sha256,
            url: result.url,
            originalSize: result.original_size,
            originalName: file.name,
            quality: videoQuality,
            resolution: videoResolution,
          });
          setVideoResult(result);

          completedSteps++;
          setUploadProgress((completedSteps / totalFiles) * 100);
          continue; // skip the normal upload path
        }

        // ─── Upload (images + raw videos) ───
        setUploadStatus(`Uploading ${file.name}${processedInfo}...`);

        // Shared transport: streamUpload for videos (avoids the arrayBuffer()
        // memory spike that crashes iOS Safari), BlossomUploader fan-out for
        // images. stripMetadata:false — fileToUpload was already
        // processed/stripped above.
        const { sha256, url } = await uploadMediaFile(
          fileToUpload, selectedRelays, user.signer, { stripMetadata: false },
        );

        // Track videos for processing
        if (isVideo && sha256) {
          uploadedVideos.push({ sha256, url, size: fileToUpload.size, name: file.name });
        }

        completedSteps++;
        setUploadProgress((completedSteps / totalFiles) * 100);
      }

      // ─── Post-upload: offer video processing ───
      if (uploadedVideos.length > 0) {
        const v = uploadedVideos[0]; // Process first video
        setPendingVideo({
          sha256: v.sha256,
          url: v.url,
          originalSize: v.size,
          originalName: v.name,
          quality: 'medium',
          resolution: 'original',
        });
      }

      const imageNote = compressImages ? ' (compressed + metadata stripped)' : ' (metadata stripped)';
      toast({
        title: "Success",
        description: `Uploaded ${totalFiles} file(s)${totalFiles > 0 && mediaMimeType(files[0]).startsWith('image/') ? imageNote : ''}` +
          (gifWarnings.length ? ` — ${gifWarnings.join(' ')}` : ''),
        variant: gifWarnings.length ? 'destructive' : 'default',
      });
      queryClient.invalidateQueries({ queryKey: ['blossom-blobs'] });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error(err);
      // Merge warnings from files that already uploaded (TOAST_LIMIT is 1 —
      // the error toast replaces whatever is showing, so carry them here)
      toast({
        title: "Upload Error",
        description: ((err as Error).message || 'Upload failed') +
          (gifWarnings.length ? ` — ${gifWarnings.join(' ')}` : ''),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleFiles(files);
  };

  const { isDragging, dropzoneProps } = useFileDropzone({
    disabled: isUploading,
    onFiles: handleFiles,
  });

  // ─── Video processing handlers ───

  const handleProcessVideo = async () => {
    if (!pendingVideo || !user || !blossomRelays[0]) return;

    setIsProcessingVideo(true);
    setVideoResult(null);

    try {
      const result = await processVideo(
        blossomRelays[0],
        pendingVideo.sha256,
        pendingVideo.quality,
        pendingVideo.resolution,
        user.signer,
      );
      setVideoResult(result);
    } catch (err) {
      toast({ title: "Video processing failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsProcessingVideo(false);
    }
  };

  const handleAcceptVideo = async () => {
    if (!videoResult || !pendingVideo || !user || !blossomRelays[0]) return;

    // Delete the original blob — only if an original was stored (raw upload
    // + transcode path). The streaming transcode path returns empty
    // original_sha because no original is persisted on the server.
    if (videoResult.original_sha && videoResult.original_sha !== videoResult.sha256) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const authEvent = await user.signer.signEvent({
          kind: 24242,
          content: 'Delete original video',
          created_at: now,
          tags: [
            ['t', 'delete'],
            ['expiration', (now + 60).toString()],
            ['x', videoResult.original_sha],
          ],
        });
        const authBase64 = btoa(JSON.stringify(authEvent));

        await fetch(`${blossomRelays[0]}/${videoResult.original_sha}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Nostr ${authBase64}` },
        });
      } catch (e) {
        console.warn('Failed to delete original video:', e);
      }
    }

    const savings = ((1 - videoResult.size / pendingVideo.originalSize) * 100).toFixed(0);
    toast({
      title: "Video processed",
      description: `${pendingVideo.originalName}: ${formatBytes(pendingVideo.originalSize)} → ${formatBytes(videoResult.size)} (-${savings}%)`,
    });

    queryClient.invalidateQueries({ queryKey: ['blossom-blobs'] });
    setPendingVideo(null);
    setVideoResult(null);
  };

  const handleRejectVideo = async () => {
    if (!videoResult || !blossomRelays[0] || !user) {
      setPendingVideo(null);
      setVideoResult(null);
      return;
    }

    // Delete the processed blob
    try {
      const now = Math.floor(Date.now() / 1000);
      const authEvent = await user.signer.signEvent({
        kind: 24242,
        content: 'Delete processed video',
        created_at: now,
        tags: [
          ['t', 'delete'],
          ['expiration', (now + 60).toString()],
          ['x', videoResult.sha256],
        ],
      });
      const authBase64 = btoa(JSON.stringify(authEvent));

      await fetch(`${blossomRelays[0]}/${videoResult.sha256}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Nostr ${authBase64}` },
      });
    } catch (e) {
      console.warn('Failed to delete processed video:', e);
    }

    setPendingVideo(null);
    setVideoResult(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Media</CardTitle>
        <CardDescription>Upload images or videos. Image metadata is always stripped on upload.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Processing options */}
        <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="compress-images"
              className="h-4 w-4"
              checked={compressImages}
              onChange={e => setCompressImages(e.target.checked)}
            />
            <div>
              <label htmlFor="compress-images" className="text-sm font-medium cursor-pointer">Compress images (WebP)</label>
              <p className="text-xs text-muted-foreground">Re-encode to WebP for ~30% smaller files. Metadata is always stripped regardless.</p>
            </div>
          </div>

          {compressImages && (
            <div className="ml-7 space-y-3">
              <div className="flex items-center gap-3">
                <Label className="text-xs whitespace-nowrap">Quality: {imageQuality}%</Label>
                <input
                  type="range"
                  min="60"
                  max="95"
                  value={imageQuality}
                  onChange={e => setImageQuality(Number(e.target.value))}
                  className="flex-1 h-2"
                />
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-xs whitespace-nowrap">Max dimension:</Label>
                <Select value={maxImageDim.toString()} onValueChange={v => setMaxImageDim(Number(v))}>
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024">1024px</SelectItem>
                    <SelectItem value="2048">2048px</SelectItem>
                    <SelectItem value="4096">4096px</SelectItem>
                    <SelectItem value="0">Original</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground border-t pt-3">
            Image metadata (EXIF, GPS, camera info) is always stripped on upload. Videos are uploaded as-is, then transcoded to MP4 (H.264/AAC) server-side with metadata stripped.
          </p>

          {/* Video streaming transcode option */}
          <div className="border-t pt-3 space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="process-videos-upload"
                className="h-4 w-4"
                checked={processVideosOnUpload}
                onChange={e => setProcessVideosOnUpload(e.target.checked)}
              />
              <div>
                <label htmlFor="process-videos-upload" className="text-sm font-medium cursor-pointer">Transcode videos on upload</label>
                <p className="text-xs text-muted-foreground">Stream directly to ffmpeg — avoids memory issues on mobile. Original is never stored.</p>
              </div>
            </div>

            {processVideosOnUpload && (
              <div className="ml-7 flex flex-wrap gap-3 items-center">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Quality:</Label>
                  <Select value={videoQuality} onValueChange={v => setVideoQuality(v as VideoQuality)}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">High (CRF 18)</SelectItem>
                      <SelectItem value="medium">Medium (CRF 23)</SelectItem>
                      <SelectItem value="low">Low (CRF 28)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Resolution:</Label>
                  <Select value={videoResolution} onValueChange={v => setVideoResolution(v as VideoResolution)}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Original</SelectItem>
                      <SelectItem value="1080">1080p</SelectItem>
                      <SelectItem value="720">720p</SelectItem>
                      <SelectItem value="480">480p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Upload area */}
        <div
          className={cn(
            "group relative border-2 border-dashed rounded-xl p-12 text-center transition-colors",
            isUploading ? "opacity-50 pointer-events-none" :
            isDragging ? "border-primary bg-primary/10" :
            "hover:border-primary/50 hover:bg-muted/50 cursor-pointer"
          )}
          onClick={() => !isDragging && fileInputRef.current?.click()}
          {...dropzoneProps}
        >
          <input
            type="file"
            className="hidden"
            ref={fileInputRef}
            onChange={handleUpload}
            multiple
            accept="image/*,video/*"
          />
          <div className="flex flex-col items-center gap-2">
            <div className="p-4 rounded-full bg-primary/10 text-primary group-hover:scale-110 transition-transform">
              {isUploading ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
            </div>
            <div className="font-medium">
              {isUploading ? (uploadStatus || 'Uploading...') :
               isDragging ? "Drop files here" : "Browse or drag & drop"}
            </div>
            <div className="text-xs text-muted-foreground">
              {isUploading ? 'This may take a moment for large files' : "Images and videos supported"}
            </div>
            {isUploading && totalFiles > 1 && uploadProgress > 0 && (
              <Progress value={uploadProgress} className="w-full max-w-xs h-2" />
            )}
          </div>
        </div>

        {/* Video processing panel */}
        {pendingVideo && (
          <div className="p-4 border-2 border-primary/30 rounded-lg space-y-4 bg-primary/5">
            <div className="flex items-center gap-2">
              <FileVideo className="h-5 w-5 text-primary" />
              <h4 className="text-sm font-semibold">Video Processing</h4>
            </div>

            <div className="text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Original:</span>
                <span className="font-mono">{pendingVideo.originalName} ({formatBytes(pendingVideo.originalSize)})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated output:</span>
                <span className="font-mono">~{formatBytes(estimateVideoSize(pendingVideo.originalSize, pendingVideo.quality, pendingVideo.resolution))}</span>
              </div>
            </div>

            {!videoResult && !isProcessingVideo && (
              <div className="space-y-3">
                <div className="flex gap-2 items-center">
                  <Label className="text-xs whitespace-nowrap">Quality:</Label>
                  <Select value={pendingVideo.quality} onValueChange={v => setPendingVideo(prev => prev ? { ...prev, quality: v as VideoQuality } : null)}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">High (CRF 18)</SelectItem>
                      <SelectItem value="medium">Medium (CRF 23)</SelectItem>
                      <SelectItem value="low">Low (CRF 28)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label className="text-xs whitespace-nowrap ml-2">Resolution:</Label>
                  <Select value={pendingVideo.resolution} onValueChange={v => setPendingVideo(prev => prev ? { ...prev, resolution: v as VideoResolution } : null)}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Original</SelectItem>
                      <SelectItem value="1080">1080p</SelectItem>
                      <SelectItem value="720">720p</SelectItem>
                      <SelectItem value="480">480p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleProcessVideo} size="sm" className="flex-1">
                    <Download className="h-4 w-4 mr-2" /> Process Video
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingVideo(null)}>
                    Skip
                  </Button>
                </div>
              </div>
            )}

            {isProcessingVideo && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="text-sm">Transcoding with ffmpeg... (this may take a minute)</span>
              </div>
            )}

            {videoResult && (
              <>
                <div className="space-y-2">
                  <div className="text-xs space-y-1 p-3 bg-muted/50 rounded">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Original:</span>
                      <span className="font-mono">{formatBytes(videoResult.original_size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Processed:</span>
                      <span className="font-mono text-green-600 dark:text-green-400">{formatBytes(videoResult.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Savings:</span>
                      <span className="font-mono text-green-600 dark:text-green-400">
                        -{((1 - videoResult.size / videoResult.original_size) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg overflow-hidden border bg-black">
                    <video
                      src={videoResult.url}
                      controls
                      className="w-full max-h-[300px]"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleAcceptVideo} size="sm" className="flex-1">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {videoResult.original_sha ? 'Accept & Delete Original' : 'Accept'}
                  </Button>
                  <Button variant="outline" onClick={handleRejectVideo} size="sm">
                    <XCircle className="h-4 w-4 mr-2" /> Reject
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Target servers */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Target Servers</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {blossomRelays.map((relay) => (
              <div key={relay} className="flex items-center space-x-2 bg-muted/30 p-2 rounded-md border">
                <Checkbox
                  id={`upload-relay-${relay}`}
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
                  htmlFor={`upload-relay-${relay}`}
                  className="text-xs font-mono truncate cursor-pointer flex-1"
                >
                  {relay.replace('https://', '')}
                </label>
              </div>
            ))}
          </div>
          {blossomRelays.length > 1 && (
            <div className="flex items-center gap-2 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-3 w-3" />
              It's recommended to upload to multiple servers to ensure availability and censorship resistance.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Media URL extraction helpers ---

const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|mp4|webm|mov|qt|mp3|ogg|wav|pdf|heic|heif)$/i;
const URL_REGEX = /https?:\/\/[^\s"'<>)\]]+/g;

interface HarvestedUrl {
  url: string;
  sha256: string | null; // extracted from URL path if blossom-style
  mimeType: string | null;
  sourceEventId: string;
  pubkey: string;
  kind: number;
  isBlossom: boolean;
  createdAt: number; // event.created_at — original publication date
}

type HarvestStatus = 'pending' | 'mirrored' | 'uploaded' | 'skipped' | 'error';

interface HarvestItem extends HarvestedUrl {
  status: HarvestStatus;
  message?: string;
}

const SHA256_RE = /\b([0-9a-f]{64})\b/i;

function extractSha256FromUrl(url: string): string | null {
  const m = url.match(SHA256_RE);
  return m ? m[1].toLowerCase() : null;
}

/** Check if a relay URL points to our own relay (localhost or the current host). */
function isLocalSource(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
           host === window.location.hostname;
  } catch {
    return false;
  }
}

function extractMediaUrlsFromEvent(event: NostrEvent): HarvestedUrl[] {
  const found = new Map<string, HarvestedUrl>();

  const add = (url: string, mimeType: string | null) => {
    if (found.has(url)) return;
    const sha256 = extractSha256FromUrl(url);
    found.set(url, {
      url,
      sha256,
      mimeType,
      sourceEventId: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      isBlossom: sha256 !== null,
      createdAt: event.created_at,
    });
  };

  // imeta tags: ['imeta', 'url https://...', 'm image/jpeg', ...]
  for (const tag of event.tags) {
    if (tag[0] === 'imeta') {
      let url: string | null = null;
      let mime: string | null = null;
      for (const part of tag.slice(1)) {
        if (part.startsWith('url ')) url = part.slice(4).trim();
        if (part.startsWith('m ')) mime = part.slice(2).trim();
      }
      if (url && MEDIA_EXTENSIONS.test(url.replace(/[?#].*$/, ''))) add(url, mime);
    }
  }

  // image/thumb/banner tags (kind 0 profile, kind 30023 articles)
  for (const tag of event.tags) {
    if (['image', 'thumb', 'banner', 'picture'].includes(tag[0]) && tag[1]) {
      const url = tag[1];
      if (MEDIA_EXTENSIONS.test(url.replace(/[?#].*$/, ''))) add(url, null);
    }
  }

  // kind 0 JSON content fields
  if (event.kind === 0) {
    try {
      const profile = JSON.parse(event.content) as Record<string, string>;
      for (const field of ['picture', 'banner', 'image']) {
        const url = profile[field];
        if (url && MEDIA_EXTENSIONS.test(url.replace(/[?#].*$/, ''))) add(url, null);
      }
    } catch { /* not JSON */ }
  }

  // Scan raw content text for media URLs
  if (event.content) {
    for (const url of event.content.matchAll(URL_REGEX)) {
      const u = url[0].replace(/[.,;:!?)]+$/, ''); // strip trailing punctuation
      if (MEDIA_EXTENSIONS.test(u.replace(/[?#].*$/, ''))) add(u, null);
    }
  }

  return [...found.values()];
}

// --- Harvest Media Section ---

function HarvestMediaSection() {
  const { user } = useCurrentUser();
  const { config, updateConfig } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = useNostrPublish();

  // Source relay selection (mirrors sync page pattern)
  const [sourceRelay, setSourceRelay] = useState<string>('');
  const [customSource, setCustomSource] = useState('');

  // Target blossom server
  const blossomRelays = useMemo(() => {
    const stored = config.siteConfig?.blossomRelays || [];
    const defaultRelay = config.siteConfig?.defaultRelay;
    const relays = [...stored];
    if (defaultRelay) {
      const normalized = defaultRelay.replace(/\/$/, '')
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://');
      if (!relays.includes(normalized)) relays.unshift(normalized);
    }
    return relays;
  }, [config.siteConfig]);

  const [targetBlossom, setTargetBlossom] = useState<string>('');
  useEffect(() => {
    if (!targetBlossom && blossomRelays.length > 0) setTargetBlossom(blossomRelays[0]);
  }, [blossomRelays, targetBlossom]);

  // Relay options (same as sync page)
  const relayOptions = useMemo(() => {
    const options = [
      ...(config.relayMetadata?.relays || []).filter(r => !!r.url).map(r => ({
        label: r.url.replace(/^wss?:\/\//, ''),
        value: r.url,
      })),
    ];
    const def = config.siteConfig?.defaultRelay;
    if (def && !options.some(o => o.value === def)) {
      options.unshift({ label: `CMS Default (${def.replace(/^wss?:\/\//, '')})`, value: def });
    }
    options.push({ label: 'Custom URL...', value: 'custom' });
    return options;
  }, [config.relayMetadata?.relays, config.siteConfig?.defaultRelay]);

  // Harvest state
  const [isRunning, setIsRunning] = useState(false);
  const [isScanOnly, setIsScanOnly] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [items, setItems] = useState<HarvestItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ scanned: 0, found: 0, mirrored: 0, uploaded: 0, skipped: 0, errors: 0 });
  const abortRef = useRef<boolean>(false);
  const logRef = useRef<HTMLDivElement>(null);
  const autoHarvest24h = config.siteConfig?.autoHarvest24h ?? false;
  const [isAutoHarvesting, setIsAutoHarvesting] = useState(false);

  const handleStop = () => { abortRef.current = true; };

  // --- 24h Auto-Backup ---

  /** Toggle the auto-harvest flag in the kind 30078 site-config event. */
  const handleToggleAutoHarvest = async (enable: boolean) => {
    if (!user) return;
    try {
      const masterPk = getMasterPubkey();
      const scopedDTag = getSiteConfigDTag();
      const signal = AbortSignal.timeout(5000);
      const events = await nostr.query([
        { kinds: [30078], authors: [masterPk], '#d': [scopedDTag], limit: 1 }
      ], { signal });

      // Preserve all existing tags, only replace auto_harvest_24h + updated_at
      let tags: string[][] = [];
      let content = '';
      if (events.length > 0) {
        const existing = events[0];
        content = existing.content;
        tags = existing.tags.filter(([name]) => name !== 'auto_harvest_24h' && name !== 'updated_at');
      } else {
        tags = [['d', scopedDTag]];
      }
      const now = Math.floor(Date.now() / 1000);
      tags.push(['auto_harvest_24h', enable.toString()]);
      tags.push(['updated_at', now.toString()]);

      await publishEvent({ event: { kind: 30078, content, tags } });

      updateConfig((currentConfig) => ({
        ...currentConfig,
        siteConfig: {
          ...(currentConfig.siteConfig || {}),
          autoHarvest24h: enable,
          updatedAt: now,
        },
      }));

      toast({
        title: enable ? '24h auto-backup enabled' : '24h auto-backup disabled',
        description: enable
          ? 'Daily cron armed. Running a 24h harvest now...'
          : 'Daily automatic harvesting has been turned off.',
      });

      if (enable) {
        runAutoHarvest24h();
      }
    } catch (e) {
      console.error('Failed to toggle auto-harvest:', e);
      toast({ title: 'Failed to update setting', description: String(e), variant: 'destructive' });
    }
  };

  /** Run an immediate 24h harvest: scan all events from the last 24h on the
   *  local relay and mirror any media that isn't already stored. */
  const runAutoHarvest24h = async () => {
    if (!user) return;
    const targetBlossomUrl = blossomRelays[0];
    if (!targetBlossomUrl) {
      toast({ title: 'No Blossom server configured', variant: 'destructive' });
      return;
    }

    setIsAutoHarvesting(true);
    setIsRunning(true);
    abortRef.current = false;
    setItems([]);
    setProgress(0);
    setStats({ scanned: 0, found: 0, mirrored: 0, uploaded: 0, skipped: 0, errors: 0 });

    try {
      const localRelayUrl = getDefaultRelayUrl();
      const relay = new NRelay1(localRelayUrl, { verifyEvent: () => true });

      const now = Math.floor(Date.now() / 1000);
      const sinceTs = now - 86400;

      // Paginate through all events in the 24h window (no author filter —
      // scan everything on the relay so all members' media is backed up)
      const allEvents: NostrEvent[] = [];
      const PAGE_SIZE = 500;
      let untilCursor: number | undefined = now;
      let lastCount = 0;
      while (true) {
        if (abortRef.current) break;
        const filter: Record<string, unknown> = { since: sinceTs, limit: PAGE_SIZE };
        if (untilCursor !== undefined) filter.until = untilCursor;
        const page = await relay.query([filter as Parameters<typeof relay.query>[0][0]]);
        if (page.length === 0) break;
        for (const ev of page) allEvents.push(ev);
        setStats(prev => ({ ...prev, scanned: allEvents.length }));
        if (page.length < PAGE_SIZE) break;
        if (page.length === lastCount && page.length < PAGE_SIZE) break;
        lastCount = page.length;
        const oldest = page.reduce((min, ev) => ev.created_at < min ? ev.created_at : min, page[0].created_at);
        const nextUntil = oldest - 1;
        if (nextUntil < sinceTs) break;
        if (untilCursor !== undefined && nextUntil >= untilCursor) break;
        untilCursor = nextUntil;
      }

      // Extract all media URLs
      const seen = new Set<string>();
      const allItems: HarvestItem[] = [];
      for (const ev of allEvents) {
        for (const entry of extractMediaUrlsFromEvent(ev)) {
          if (!seen.has(entry.url)) {
            seen.add(entry.url);
            allItems.push({ ...entry, status: 'pending' });
          }
        }
      }
      setItems(allItems);
      setStats(prev => ({ ...prev, found: allItems.length }));

      if (allItems.length === 0) {
        setProgress(100);
        toast({ title: '24h harvest complete', description: 'No media found in the last 24h.' });
        return;
      }

      // Get existing blob hashes to skip duplicates
      let existingHashes = new Set<string>();
      try {
        const res = await fetch(`${targetBlossomUrl}/list/${user.pubkey}`);
        if (res.ok) {
          const blobs = await res.json() as { sha256: string }[];
          existingHashes = new Set(blobs.map(b => b.sha256.toLowerCase()));
        }
      } catch { /* ok — will just re-mirror */ }

      let mirrored = 0, skipped = 0, errors = 0;
      for (let i = 0; i < allItems.length; i++) {
        if (abortRef.current) break;
        const item = allItems[i];

        // Skip if already stored (still send /mirror to update owner+date)
        if (item.sha256 && existingHashes.has(item.sha256.toLowerCase())) {
          try {
            await fetch(`${targetBlossomUrl}/mirror`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'X-Original-Date': item.createdAt.toString(),
                'X-Owner-Pubkey': item.pubkey,
              },
              body: JSON.stringify({ url: item.url }),
            });
          } catch { /* non-fatal */ }
          skipped++;
          setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'skipped' } : it));
          setStats(prev => ({ ...prev, skipped }));
          setProgress(Math.round(((i + 1) / allItems.length) * 100));
          continue;
        }

        try {
          const res = await fetch(`${targetBlossomUrl}/mirror`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Original-Date': item.createdAt.toString(),
              'X-Owner-Pubkey': item.pubkey,
            },
            body: JSON.stringify({ url: item.url }),
          });
          if (res.ok) {
            mirrored++;
            setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'mirrored' } : it));
          } else {
            errors++;
            setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error', message: `HTTP ${res.status}` } : it));
          }
        } catch (e) {
          errors++;
          setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error', message: String(e) } : it));
        }

        setStats(prev => ({ ...prev, mirrored, errors }));
        setProgress(Math.round(((i + 1) / allItems.length) * 100));
      }

      queryClient.invalidateQueries({ queryKey: ['blossom-blobs'] });
      toast({
        title: '24h harvest complete',
        description: `Mirrored: ${mirrored}, Skipped: ${skipped}, Errors: ${errors}`,
      });
    } catch (e) {
      toast({ title: '24h harvest failed', description: String(e), variant: 'destructive' });
    } finally {
      setIsAutoHarvesting(false);
      setIsRunning(false);
    }
  };

  const handleHarvest = async () => {
    if (!user) return;
    const sourceUrl = sourceRelay === 'custom' ? customSource : sourceRelay;
    if (!sourceUrl) { toast({ title: 'Select a source relay', variant: 'destructive' }); return; }
    if (!isScanOnly && !targetBlossom) { toast({ title: 'Select a target Blossom server', variant: 'destructive' }); return; }

    setIsRunning(true);
    abortRef.current = false;
    setItems([]);
    setProgress(0);
    setStats({ scanned: 0, found: 0, mirrored: 0, uploaded: 0, skipped: 0, errors: 0 });

    try {
      // 1. Fetch all events from source relay — paginate in batches of 500 using `until`
      // When the source is our own relay, skip signature verification because
      // it stores unsigned kind-24242 (Blossom blob index) events created
      // internally by the Blossom library. Dropping those would reduce the
      // page size below PAGE_SIZE and break pagination.
      // For external relays, keep default verification for security — but
      // use a larger request limit and don't break early on short pages,
      // since some events may be dropped by signature verification.
      const isLocalRelay = isLocalSource(sourceUrl);
      const relay = new NRelay1(sourceUrl, isLocalRelay ? { verifyEvent: () => true } : {});
      const events: NostrEvent[] = [];
      const PAGE_SIZE = 500;

      // Date range bounds (unix seconds)
      const sinceTs = dateRange?.from ? Math.floor(dateRange.from.getTime() / 1000) : undefined;
      // until: end of the selected day (to +1 day - 1 sec), or page cursor
      const untilBound = dateRange?.to
        ? Math.floor(dateRange.to.getTime() / 1000) + 86399
        : undefined;

      try {
        let untilCursor: number | undefined = untilBound;
        let lastEventCount = 0;
        while (true) {
          if (abortRef.current) break;
          const filter: Record<string, unknown> = { authors: [user.pubkey], limit: PAGE_SIZE };
          if (untilCursor !== undefined) filter.until = untilCursor;
          if (sinceTs !== undefined) filter.since = sinceTs;
          const page = await relay.query([filter as Parameters<typeof relay.query>[0][0]]);
          if (page.length === 0) break;
          for (const ev of page) events.push(ev);
          setStats(prev => ({ ...prev, scanned: events.length }));

          // For local relay: break when we get fewer than PAGE_SIZE
          // (no signature filtering, so page size is accurate)
          if (isLocalRelay && page.length < PAGE_SIZE) break;

          // For external relays: don't break on short pages since events
          // may have been dropped by signature verification. Instead,
          // break only when we get the same count as last time (no progress)
          // or when we've gone before sinceTs.
          if (!isLocalRelay && page.length === lastEventCount && page.length < PAGE_SIZE) break;
          lastEventCount = page.length;

          // Next page: oldest event's created_at - 1 (but never go before sinceTs)
          const oldest = page.reduce((min, ev) => ev.created_at < min ? ev.created_at : min, page[0].created_at);
          const nextUntil = oldest - 1;
          if (sinceTs !== undefined && nextUntil < sinceTs) break;
          if (untilCursor !== undefined && nextUntil >= untilCursor) break; // no progress — avoid infinite loop
          untilCursor = nextUntil;
        }
      } catch (e) {
        toast({ title: 'Failed to fetch events', description: String(e), variant: 'destructive' });
        return;
      }
      setStats(prev => ({ ...prev, scanned: events.length }));

      // 1.5: Publish fetched events to the target relay so they're in
      // the local DB. This is important for secondary team users whose
      // events may not be on this relay yet — without publishing, the
      // /my-stats endpoint (which scans the DB) would show 0 media.
      // We publish to the targetBlossom's relay (same host, WebSocket).
      if (!isLocalRelay && targetBlossom) {
        try {
          const targetWsUrl = targetBlossom.replace(/^http/, 'ws');
          const targetRelay = new NRelay1(targetWsUrl, { verifyEvent: () => true });
          let published = 0;
          let publishErrors = 0;
          // Publish in batches to avoid overwhelming the relay
          const PUBLISH_BATCH = 50;
          for (let i = 0; i < events.length; i += PUBLISH_BATCH) {
            if (abortRef.current) break;
            const batch = events.slice(i, i + PUBLISH_BATCH);
            await Promise.all(batch.map(async (ev) => {
              try {
                await targetRelay.event(ev);
                published++;
              } catch {
                publishErrors++;
              }
            }));
          }
          if (published > 0) {
            console.log(`Harvest: published ${published} events to local relay (${publishErrors} errors)`);
          }
          targetRelay.close();
        } catch (e) {
          console.warn('Harvest: failed to publish events to local relay:', e);
        }
      }

      // 2. Extract all media URLs
      const seen = new Set<string>();
      const allItems: HarvestItem[] = [];
      for (const ev of events) {
        for (const entry of extractMediaUrlsFromEvent(ev)) {
          if (!seen.has(entry.url)) {
            seen.add(entry.url);
            allItems.push({ ...entry, status: 'pending' });
          }
        }
      }
      setItems(allItems);
      setStats(prev => ({ ...prev, found: allItems.length }));

      if (isScanOnly || allItems.length === 0) {
        setProgress(100);
        return;
      }

      // 3. For each URL: mirror (blossom) or fetch+upload (CDN)
      // First, get list of already-stored blobs to skip duplicates
      let existingHashes = new Set<string>();
      try {
        const res = await fetch(`${targetBlossom}/list/${user.pubkey}`);
        if (res.ok) {
          const blobs = await res.json() as { sha256: string }[];
          existingHashes = new Set(blobs.map(b => b.sha256));
        }
      } catch { /* ignore */ }

      // Throttle UI updates to avoid reflow thrashing with 2000+ items.
      // Batch state updates and only flush every 200ms.
      const pendingStats = { scanned: events.length, found: allItems.length, mirrored: 0, uploaded: 0, skipped: 0, errors: 0 };
      let pendingItemUpdates: { url: string; patch: Partial<HarvestItem> }[] = [];
      let lastFlush = 0;
      let done = 0;

      const flushUI = () => {
        const now = Date.now();
        if (now - lastFlush < 200 && done < allItems.length) return;
        lastFlush = now;
        if (pendingItemUpdates.length > 0) {
          setItems(prev => prev.map(item => {
            const update = pendingItemUpdates.find(u => u.url === item.url);
            return update ? { ...item, ...update.patch } : item;
          }));
          pendingItemUpdates = [];
        }
        setStats({ ...pendingStats });
        setProgress(Math.round((done / allItems.length) * 100));
      };

      // Direct upload fallback (for CDN URLs that can't be server-side mirrored)
      const directUpload = async (item: HarvestItem) => {
        try {
          const fetchRes = await fetch(item.url);
          if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
          const blob = await fetchRes.blob();
          const mimeType = item.mimeType || blob.type || 'application/octet-stream';
          const filename = item.url.split('/').pop()?.split('?')[0] || 'media';
          const file = new File([blob], filename, { type: mimeType });

          const hashBuf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
          const sha256 = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

          const now = Math.floor(Date.now() / 1000);
          const authEvent = await user!.signer.signEvent({
            kind: 24242,
            content: `Upload ${filename}`,
            created_at: now,
            tags: [
              ['t', 'upload'],
              ['x', sha256],
              ['size', file.size.toString()],
              ['expiration', (now + 60).toString()],
            ],
          });
          const authorization = `Nostr ${btoa(JSON.stringify(authEvent))}`;

          const uploadRes = await fetch(new URL('/upload', targetBlossom).toString(), {
            method: 'PUT',
            headers: { 'Authorization': authorization, 'Content-Type': mimeType },
            body: file,
          });
          if (!uploadRes.ok) {
            const msg = uploadRes.headers.get('X-Reason') || await uploadRes.text();
            throw new Error(msg);
          }

          // Set file mod time + owner via /mirror early-exit
          if (item.createdAt) {
            try {
              await fetch(`${targetBlossom}/mirror`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Original-Date': item.createdAt.toString(),
                  'X-Owner-Pubkey': user!.pubkey,
                },
                body: JSON.stringify({ url: item.url }),
              });
            } catch { /* non-fatal */ }
          }

          pendingItemUpdates.push({ url: item.url, patch: { status: 'uploaded' } });
          pendingStats.uploaded++;
        } catch (e) {
          pendingItemUpdates.push({ url: item.url, patch: { status: 'error', message: String(e) } });
          pendingStats.errors++;
        }
      };

      // Process a single skip-path item (existing blob — just update owner+date)
      const processSkip = async (item: HarvestItem) => {
        try {
          await fetch(`${targetBlossom}/mirror`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Original-Date': item.createdAt.toString(),
              'X-Owner-Pubkey': user.pubkey,
            },
            body: JSON.stringify({ url: item.url }),
          });
        } catch { /* non-fatal */ }
        pendingItemUpdates.push({ url: item.url, patch: { status: 'skipped', message: 'Already stored' } });
        pendingStats.skipped++;
        done++;
      };

      // Process skip-path items in parallel (5 at a time) — these are quick
      // /mirror calls that hit the early-exit path (no download, just os.Chtimes)
      const skipItems = allItems.filter(item => item.sha256 && existingHashes.has(item.sha256));
      const newItems = allItems.filter(item => !(item.sha256 && existingHashes.has(item.sha256)));

      const SKIP_CONCURRENCY = 5;
      for (let i = 0; i < skipItems.length; i += SKIP_CONCURRENCY) {
        if (abortRef.current) break;
        const batch = skipItems.slice(i, i + SKIP_CONCURRENCY);
        await Promise.all(batch.map(processSkip));
        flushUI();
      }

      // Process new items sequentially (they involve downloads)
      for (const item of newItems) {
        if (abortRef.current) break;

        // Always try server-side mirror first (no CORS issues, no browser bandwidth).
        // Falls back to browser fetch+upload only if mirror endpoint rejects it.
        // Pass the original event's created_at so the backend can set the file's
        // modification time to the original publication date.
        let mirrored = false;
        try {
          const res = await fetch(`${targetBlossom}/mirror`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Original-Date': item.createdAt.toString(),
              'X-Owner-Pubkey': user.pubkey,
            },
            body: JSON.stringify({ url: item.url }),
          });
          if (res.ok) {
            mirrored = true;
            pendingItemUpdates.push({ url: item.url, patch: { status: 'mirrored' } });
            pendingStats.mirrored++;
          }
          // Non-OK means mirror is disabled or SSRF block → fall through
        } catch { /* network error talking to our own server — fall through */ }

        if (!mirrored) {
          await directUpload(item);
        }
        done++;
        flushUI();
      }

      flushUI();
      setProgress(100);
      queryClient.invalidateQueries({ queryKey: ['blossom-blobs'] });
      toast({ title: 'Harvest complete' });
    } finally {
      setIsRunning(false);
    }
  };

  const sourceUrl = sourceRelay === 'custom' ? customSource : sourceRelay;
  const canRun = !!user && !!sourceUrl && (isScanOnly || !!targetBlossom);

  return (
    <div className="space-y-6">
      {/* Source */}
      <Card>
        <CardHeader>
          <CardTitle>Source Relay</CardTitle>
          <CardDescription>Relay to scan for your events with media</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={sourceRelay} onValueChange={setSourceRelay}>
            <SelectTrigger><SelectValue placeholder="Select a relay" /></SelectTrigger>
            <SelectContent>
              {relayOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sourceRelay === 'custom' && (
            <Input placeholder="wss://..." value={customSource} onChange={e => setCustomSource(e.target.value)} />
          )}
        </CardContent>
      </Card>

      {/* Target + options */}
      <Card>
        <CardHeader>
          <CardTitle>Target Blossom Server</CardTitle>
          <CardDescription>Where to store harvested media</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={targetBlossom} onValueChange={setTargetBlossom} disabled={isScanOnly}>
            <SelectTrigger><SelectValue placeholder="Select a server" /></SelectTrigger>
            <SelectContent>
              {blossomRelays.map(r => (
                <SelectItem key={r} value={r}>{r.replace(/^https?:\/\//, '')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range filter */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Date Range <span className="text-muted-foreground font-normal">(optional — leave blank for all time)</span></Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !dateRange && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to
                      ? <>{format(dateRange.from, 'LLL dd, y')} – {format(dateRange.to, 'LLL dd, y')}</>
                      : format(dateRange.from, 'LLL dd, y')
                  ) : 'All time'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  autoFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
                {dateRange && (
                  <div className="p-2 border-t">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setDateRange(undefined)}>
                      Clear (fetch all time)
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <input
              type="checkbox"
              id="scan-only"
              className="h-4 w-4"
              checked={isScanOnly}
              onChange={e => setIsScanOnly(e.target.checked)}
            />
            <div>
              <label htmlFor="scan-only" className="text-sm font-medium cursor-pointer">Scan only (no upload)</label>
              <p className="text-xs text-muted-foreground">Find and list media URLs without storing anything</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 border rounded-lg bg-primary/5">
            <input
              type="checkbox"
              id="auto-harvest-24h"
              className="h-4 w-4"
              checked={autoHarvest24h}
              disabled={isAutoHarvesting}
              onChange={e => handleToggleAutoHarvest(e.target.checked)}
            />
            <div>
              <label htmlFor="auto-harvest-24h" className="text-sm font-medium cursor-pointer">
                24h auto-backup
                {isAutoHarvesting && <Loader2 className="inline-block ml-2 h-3 w-3 animate-spin" />}
              </label>
              <p className="text-xs text-muted-foreground">
                Mirror all media from the last 24h to {blossomRelays[0]?.replace(/^https?:\/\//, '') || 'the first Blossom server'} daily.
                Runs immediately when enabled. A server-side cron job backs up new media at end of day.
              </p>
            </div>
          </div>

          <div className="p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground space-y-1">
            <p><strong>How it works:</strong></p>
            <p>• All URLs tried via server-side <code>/mirror</code> first — no browser bandwidth, no CORS issues</p>
            <p>• Fallback: fetch in browser → upload via <code>/upload</code> with NIP-98 auth</p>
            <p>• Paginates through all your events (not just the first 250)</p>
            <p>• Already-stored blobs are skipped automatically</p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Button
              onClick={handleHarvest}
              disabled={isRunning || !canRun}
              className="min-w-[160px]"
              size="lg"
            >
              {isRunning ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running...</>
              ) : (
                <><Download className="mr-2 h-4 w-4" />{isScanOnly ? 'Scan Events' : 'Harvest Media'}</>
              )}
            </Button>
            {isRunning && (
              <Button variant="outline" onClick={handleStop} size="lg">
                <XCircle className="mr-2 h-4 w-4" />Stop
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              onClick={async () => {
                if (!targetBlossom) return;
                try {
                  const res = await fetch(`${targetBlossom}/backfill-owners`, { method: 'POST' });
                  if (res.ok) {
                    const data = await res.json();
                    toast({ title: 'Owner backfill complete', description: `${data.blobs_with_owner}/${data.total_blobs} blobs mapped (${data.coverage_pct}%)` });
                  }
                } catch (e) {
                  toast({ title: 'Backfill failed', description: String(e), variant: 'destructive' });
                }
              }}
              title="Scan events to map existing blobs to their owners (one-time maintenance)"
            >
              Backfill owners
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress & results */}
      {(isRunning || items.length > 0 || stats.scanned > 0) && (
        <Card className="bg-slate-950 text-slate-50 border-slate-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-slate-400">Harvest Status</CardTitle>
              <div className="flex flex-wrap gap-3 text-xs font-mono">
                <span className="text-slate-400">Events: {stats.scanned}</span>
                <span className="text-blue-400">Found: {stats.found}</span>
                {!isScanOnly && <>
                  <span className="text-green-400">Mirrored: {stats.mirrored}</span>
                  <span className="text-cyan-400">Uploaded: {stats.uploaded}</span>
                  <span className="text-slate-500">Skipped: {stats.skipped}</span>
                  {stats.errors > 0 && <span className="text-red-400">Errors: {stats.errors}</span>}
                </>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isRunning && <Progress value={progress} className="h-1.5 bg-slate-800" />}
            <ScrollArea className="h-[300px] rounded border border-slate-800 bg-slate-900" ref={logRef}>
              <div className="p-3 space-y-1 font-mono text-xs">
                {items.length === 0 && stats.scanned === 0 && (
                  <p className="text-slate-500">Scanning events...</p>
                )}
                {items.length === 0 && stats.scanned > 0 && (
                  <p className="text-slate-400">Scanned {stats.scanned} events — no media URLs found.</p>
                )}
                {items.map(item => (
                  <div key={item.url} className="flex items-start gap-2">
                    {item.status === 'pending' && <Loader2 className="h-3 w-3 mt-0.5 animate-spin text-slate-500 shrink-0" />}
                    {item.status === 'mirrored' && <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-400 shrink-0" />}
                    {item.status === 'uploaded' && <CheckCircle2 className="h-3 w-3 mt-0.5 text-cyan-400 shrink-0" />}
                    {item.status === 'skipped' && <SkipForward className="h-3 w-3 mt-0.5 text-slate-500 shrink-0" />}
                    {item.status === 'error' && <XCircle className="h-3 w-3 mt-0.5 text-red-400 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <span className={cn(
                        'break-all',
                        item.status === 'error' ? 'text-red-400' :
                        item.status === 'skipped' ? 'text-slate-600' :
                        item.status === 'pending' ? 'text-slate-400' :
                        'text-slate-200'
                      )}>
                        {item.url.length > 80 ? item.url.slice(0, 77) + '…' : item.url}
                      </span>
                      {item.message && <span className="ml-2 text-slate-500">{item.message}</span>}
                      <span className="ml-2 text-slate-600">kind:{item.kind}</span>
                      {item.isBlossom && <span className="ml-1 text-slate-600">[blossom]</span>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Main AdminMedia Component
 */
export default function AdminMedia() {
  const [activeTab, setActiveTab] = useState('browse');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Media Management</h2>
        <p className="text-muted-foreground">
          Manage Blossom servers, browse stored media, and upload new content.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="servers">
            <Server className="h-4 w-4 mr-2" />
            Servers
          </TabsTrigger>
          <TabsTrigger value="browse">
            <Search className="h-4 w-4 mr-2" />
            Browse
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="harvest">
            <Download className="h-4 w-4 mr-2" />
            Harvest
          </TabsTrigger>
        </TabsList>

        <TabsContent value="servers" className="space-y-6">
          <ManageServersSection />
        </TabsContent>

        <TabsContent value="browse" className="space-y-6">
          <BrowseMediaSection />
        </TabsContent>

        <TabsContent value="upload" className="space-y-6">
          <UploadMediaSection />
        </TabsContent>

        <TabsContent value="harvest" className="space-y-6">
          <HarvestMediaSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
