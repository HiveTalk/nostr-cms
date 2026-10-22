import { useState, useRef, useEffect } from 'react';
import { useSeoMeta } from '@unhead/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { RefreshCw, XCircle, Calendar as CalendarIcon, Wifi, Trash2, GripVertical, Check, Plus, AlertTriangle } from 'lucide-react';

const DEFAULT_RELAYS = [
    { url: 'wss://relay.damus.io', read: true, write: true },
    { url: 'wss://nos.lol', read: true, write: true },
    { url: 'wss://relay.primal.net', read: true, write: true }
];
import { NRelay1, NostrEvent } from '@nostrify/nostrify';
import { format, addHours, differenceInHours } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, normalizeRelayUrl } from '@/lib/utils';
import { DateRange } from 'react-day-picker';
import { useToast } from '@/hooks/useToast';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type AppConfig } from '@/contexts/AppContext';

// --- Types & Constants ---

const SYNC_KINDS = [
    { kind: 0, label: 'Profile Metadata', description: 'Name, about, picture' },
    { kind: 1, label: 'Short Text Notes', description: 'Standard posts' },
    { kind: 3, label: 'Contact Lists', description: 'Follows' },
    { kind: 10000, label: 'Mute Lists', description: 'Muted users' },
    { kind: 10001, label: 'Pinned Notes', description: 'Pinned posts' },
    { kind: 10002, label: 'Relay Lists', description: 'Read/Write relays' },
    { kind: 10003, label: 'Bookmarks', description: 'Bookmarked events' },
    { kind: 10004, label: 'Communities', description: 'Community definitions' },
    { kind: 10007, label: 'Search Relays', description: 'Relays for search' },
    { kind: 10015, label: 'Interests', description: 'Interests list' },
    { kind: 10030, label: 'Emoji Lists', description: 'Custom emojis' },
    { kind: 10050, label: 'DM Relays', description: 'Relays for DMs' },
    { kind: 30000, label: 'Follow sets', description: 'Categorized follow lists' },
    { kind: 30008, label: 'Profile Badges', description: 'Badge definition and usage' },
    { kind: 30023, label: 'Long-form Content', description: 'Article/blog posts' },
    { kind: 30024, label: 'Draft Long-form Content', description: 'Draft articles' },
];

interface LogEntry {
    timestamp: number;
    message: string;
    type: 'info' | 'success' | 'error';
}

interface SortableRelayItemProps {
    relay: { url: string; read: boolean; write: boolean };
    onRemove: (url: string) => void;
}

// --- Components ---

function SortableRelayItem({ relay, onRemove }: SortableRelayItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: relay.url });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center justify-between p-4 bg-card group"
        >
            <div className="flex items-center gap-3 overflow-hidden">
                <button
                    className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded transition-colors"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100" />
                </button>
                <div className="p-2 bg-primary/10 rounded-full shrink-0">
                    <Wifi className="h-4 w-4 text-primary" />
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{relay.url}</span>
                    <div className="flex gap-2 mt-1">
                        {relay.read && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                                Read
                            </span>
                        )}
                        {relay.write && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">
                                Write
                            </span>
                        )}
                    </div>
                </div>
            </div>
            <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => onRemove(relay.url)}
            >
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
    );
}

// --- Main Page Component ---

export default function AdminSyncPage() {
    const { user } = useCurrentUser();
    const { config, updateConfig } = useAppContext();
    const { toast } = useToast();

    // Settings State
    const [newRelayUrl, setNewRelayUrl] = useState('');
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const relays = config.relayMetadata?.relays || [];

    // Sync State
    const [sourceRelay, setSourceRelay] = useState<string>('');
    const [targetRelay, setTargetRelay] = useState<string>('');
    const [customSource, setCustomSource] = useState('');
    const [customTarget, setCustomTarget] = useState('');

    const [useTimeRange, setUseTimeRange] = useState(false);
    const [sinceHours, setSinceHours] = useState<number>(-24);
    const [untilHours, setUntilHours] = useState<number>(0);
    const [dateRange, setDateRange] = useState<DateRange | undefined>();

    const [syncAll, setSyncAll] = useState(false);
    const [selectedKinds, setSelectedKinds] = useState<number[]>([]);
    const [syncDelay, setSyncDelay] = useState<number>(100); // Delay in ms

    const [isSyncing, setIsSyncing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [stats, setStats] = useState({ fetched: 0, published: 0, errors: 0 });
    const statusRef = useRef<HTMLDivElement>(null);

    useSeoMeta({
        title: 'Sync & Backup - Admin',
        description: 'Back up your events to other relays and manage relay settings.',
    });

    // --- Settings Handlers ---

    const handleAddRelay = () => {
        const normalized = normalizeRelayUrl(newRelayUrl);
        if (!normalized) {
            toast({
                title: "Invalid URL",
                description: "Please enter a valid relay URL (e.g., wss://relay.damus.io)",
                variant: "destructive",
            });
            return;
        }

        if (relays.some(r => r.url === normalized)) {
            toast({
                title: "Relay already exists",
                description: "This relay is already in your list.",
                variant: "destructive",
            });
            return;
        }

        updateConfig((current) => ({
            ...current,
            relayMetadata: {
                ...current.relayMetadata,
                relays: [...(current.relayMetadata?.relays || []), { url: normalized, read: true, write: true }],
                updatedAt: Math.floor(Date.now() / 1000),
            },
        }));

        setNewRelayUrl('');
        toast({
            title: "Relay added",
            description: `${normalized} has been added to your list.`,
        });
    };

    const handleRemoveRelay = (url: string) => {
        updateConfig((current) => {
            const nextRelays = (current.relayMetadata?.relays || []).filter(r => r.url !== url);
            const nextConfig: Partial<AppConfig> = {
                ...current,
                relayMetadata: {
                    ...current.relayMetadata!,
                    relays: nextRelays,
                    updatedAt: Math.floor(Date.now() / 1000),
                },
            };
            return nextConfig;
        });

        toast({
            title: "Relay removed",
            description: `${url} has been removed from your list.`,
        });
    };

    const handleRestoreDefaults = () => {
        updateConfig((current) => ({
            ...current,
            relayMetadata: {
                ...current.relayMetadata!,
                relays: DEFAULT_RELAYS,
                updatedAt: Math.floor(Date.now() / 1000),
            },
        }));

        toast({
            title: "Defaults restored",
            description: "Relay list has been reset to defaults.",
        });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            updateConfig((current) => {
                const oldIndex = relays.findIndex((r) => r.url === active.id);
                const newIndex = relays.findIndex((r) => r.url === over.id);

                return {
                    ...current,
                    relayMetadata: {
                        ...current.relayMetadata,
                        relays: arrayMove(relays, oldIndex, newIndex),
                        updatedAt: Math.floor(Date.now() / 1000),
                    },
                };
            });

            toast({
                title: "Order updated",
                description: "Your relay priority has been saved.",
            });
        }
    };

    // --- Sync Handlers ---

    useEffect(() => {
        if (isSyncing && statusRef.current) {
            statusRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [isSyncing]);

    const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
        setLogs(prev => [{ timestamp: Date.now(), message, type }, ...prev]);
    };

    const handleKindToggle = (kind: number) => {
        setSelectedKinds(prev =>
            prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]
        );
    };

    const handleDateRangeSelect = (range: DateRange | undefined) => {
        if (!range) {
            // Range cleared — reset to the default last-24h filter.
            setDateRange(undefined);
            setSinceHours(-24);
            setUntilHours(0);
            return;
        }
        setDateRange(range);
        if (range.from) {
            const now = new Date();
            const newSince = differenceInHours(range.from, now);
            setSinceHours(newSince);

            if (range.to) {
                const newUntil = differenceInHours(range.to, now) + 24;
                setUntilHours(newUntil);
            } else {
                setUntilHours(newSince + 24);
            }
        }
    };

    const getSelectedRangeText = () => {
        if (!useTimeRange) return 'All time (no filter)';
        const now = new Date();
        const start = addHours(now, sinceHours);
        const end = addHours(now, untilHours);
        return `from ${format(start, 'M/d/yyyy h:mm a')} to ${format(end, 'M/d/yyyy h:mm a')}`;
    };

    const getRelayOptions = () => {
        const options = [
            ...config.relayMetadata.relays.filter(r => !!r.url).map(r => ({ label: r.url.replace(/^wss?:\/\//, ''), value: r.url })),
        ];

        // Add CMS Default Relay
        if (config.siteConfig?.defaultRelay && !options.some(o => o.value === config.siteConfig?.defaultRelay)) {
            options.unshift({
                label: `CMS Default (${config.siteConfig.defaultRelay.replace(/^wss?:\/\//, '')})`,
                value: config.siteConfig.defaultRelay
            });
        }

        options.push({ label: 'Custom URL...', value: 'custom' });
        return options;
    };

    // Count-only check: fetch the user's events from the source relay
    // without republishing anywhere. Answers "how many of my events are
    // on this relay?" — the first half of "do I have a proper backup?"
    const handleCheckBackup = async () => {
        if (!user) return;

        const sourceUrl = sourceRelay === 'custom' ? customSource : sourceRelay;

        if (!sourceUrl) {
            addLog('Please select a source relay to check.', 'error');
            return;
        }

        setIsSyncing(true);
        setProgress(0);
        setLogs([]);
        setStats({ fetched: 0, published: 0, errors: 0 });
        addLog(`Checking backup status on ${sourceUrl}...`);

        try {
            const source = new NRelay1(sourceUrl);

            const kinds = syncAll ? undefined : selectedKinds.length > 0 ? selectedKinds : undefined;
            const now = new Date();
            const since = useTimeRange ? Math.floor(addHours(now, sinceHours).getTime() / 1000) : undefined;
            const until = useTimeRange ? Math.floor(addHours(now, untilHours).getTime() / 1000) : undefined;

            const filters = [{
                authors: [user.pubkey],
                kinds,
                ...(since !== undefined && { since }),
                ...(until !== undefined && { until }),
            }];

            if (useTimeRange) {
                addLog(`Time range: ${new Date(since! * 1000).toLocaleString()} to ${new Date(until! * 1000).toLocaleString()}`);
            } else {
                addLog('Time range: All time (no filter)');
            }
            addLog(`Fetching events for ${user.pubkey.slice(0, 8)}...`);

            let totalCount = 0;
            const kindCounts: Record<number, number> = {};
            const PAGE_SIZE = 500;

            try {
                let untilCursor: number | undefined = until;
                while (true) {
                    const pageFilter = { ...filters[0], limit: PAGE_SIZE, ...(untilCursor !== undefined && { until: untilCursor }) };
                    const page = await source.query([pageFilter]);
                    if (page.length === 0) break;
                    for (const event of page) {
                        totalCount++;
                        kindCounts[event.kind] = (kindCounts[event.kind] || 0) + 1;
                        setStats(prev => ({ ...prev, fetched: prev.fetched + 1 }));
                    }
                    if (totalCount % 50 === 0) {
                        addLog(`Found ${totalCount} events so far...`);
                    }
                    if (page.length < PAGE_SIZE) break;
                    const oldest = page.reduce((min, ev) => ev.created_at < min ? ev.created_at : min, page[0].created_at);
                    const nextUntil = oldest - 1;
                    if (since !== undefined && nextUntil < since) break;
                    untilCursor = nextUntil;
                }
            } catch (e) {
                console.error("Fetch error", e);
                addLog(`Error fetching from source: ${e instanceof Error ? e.message : String(e)}`, 'error');
                setIsSyncing(false);
                return;
            }

            addLog(`Check complete: you have ${totalCount} events on ${sourceUrl}.`, 'success');

            // Log a per-kind breakdown
            const sortedKinds = Object.entries(kindCounts).sort((a, b) => b[1] - a[1]);
            if (sortedKinds.length > 0) {
                const breakdown = sortedKinds.map(([k, v]) => `Kind ${k}: ${v}`).join(', ');
                addLog(`Breakdown — ${breakdown}`, 'info');
            }

            if (totalCount > 0) {
                addLog('To back up these events, set a target relay and click "Start Sync".', 'info');
            }

            setProgress(100);
        } catch (error) {
            console.error("Check error", error);
            addLog(`Unexpected error during check: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSync = async () => {
        if (!user) return;

        const sourceUrl = sourceRelay === 'custom' ? customSource : sourceRelay;
        const targetUrl = targetRelay === 'custom' ? customTarget : targetRelay;

        if (!sourceUrl || !targetUrl) {
            addLog('Please select both source and target relays.', 'error');
            return;
        }

        if (sourceUrl === targetUrl) {
            addLog('Source and target relays cannot be the same.', 'error');
            return;
        }

        if (!syncAll && selectedKinds.length === 0) {
            addLog('Please select at least one kind to sync or choose "Sync All".', 'error');
            return;
        }

        setIsSyncing(true);
        setProgress(0);
        setLogs([]);
        setStats({ fetched: 0, published: 0, errors: 0 });
        addLog(`Starting backup sync from ${sourceUrl} to ${targetUrl}...`);

        try {
            const source = new NRelay1(sourceUrl);
            const target = new NRelay1(targetUrl);

            addLog('Connecting to relays...');

            const kinds = syncAll ? undefined : selectedKinds;
            const now = new Date();
            const since = useTimeRange ? Math.floor(addHours(now, sinceHours).getTime() / 1000) : undefined;
            const until = useTimeRange ? Math.floor(addHours(now, untilHours).getTime() / 1000) : undefined;

            const filters = [{
                authors: [user.pubkey],
                kinds,
                ...(since !== undefined && { since }),
                ...(until !== undefined && { until }),
            }];

            if (useTimeRange) {
                addLog(`Time range: ${new Date(since! * 1000).toLocaleString()} to ${new Date(until! * 1000).toLocaleString()}`);
            } else {
                addLog('Time range: All time (no filter)');
            }
            addLog(`Fetching events for ${user.pubkey.slice(0, 8)}...`);

            const events: NostrEvent[] = [];
            const PAGE_SIZE = 500;

            try {
                let untilCursor: number | undefined = until;
                while (true) {
                    const pageFilter = { ...filters[0], limit: PAGE_SIZE, ...(untilCursor !== undefined && { until: untilCursor }) };
                    const page = await source.query([pageFilter]);
                    if (page.length === 0) break;
                    for (const event of page) {
                        events.push(event);
                        setStats(prev => ({ ...prev, fetched: prev.fetched + 1 }));
                    }
                    if (events.length % 50 === 0) {
                        addLog(`Fetched ${events.length} events...`);
                    }
                    if (page.length < PAGE_SIZE) break; // last page
                    const oldest = page.reduce((min, ev) => ev.created_at < min ? ev.created_at : min, page[0].created_at);
                    const nextUntil = oldest - 1;
                    if (since !== undefined && nextUntil < since) break;
                    untilCursor = nextUntil;
                }
            } catch (e) {
                console.error("Fetch error", e);
                addLog(`Error fetching from source: ${e instanceof Error ? e.message : String(e)}`, 'error');
                setIsSyncing(false);
                return;
            }

            addLog(`Total events fetched: ${events.length}. Starting publish...`);

            if (events.length === 0) {
                addLog('No events found to sync.', 'info');
                setIsSyncing(false);
                setProgress(100);
                return;
            }

            let publishedCount = 0;
            let errorCount = 0;

            for (let i = 0; i < events.length; i++) {
                const event = events[i];

                // Delay if configured
                if (syncDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, syncDelay));
                }

                try {
                    await target.event(event);
                    publishedCount++;
                    setStats(prev => ({ ...prev, published: publishedCount }));
                } catch (e) {
                    console.error("Publish error", e);
                    errorCount++;
                    setStats(prev => ({ ...prev, errors: errorCount }));
                    addLog(`Failed to publish event ${event.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`, 'error');
                }

                const currentProgress = Math.round(((i + 1) / events.length) * 100);
                setProgress(currentProgress);
            }

            addLog('Sync completed!', 'success');

        } catch (error) {
            console.error("Sync error", error);
            addLog(`Unexpected error during sync: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Sync & Backup</h1>
                <p className="text-muted-foreground text-lg">
                    Back up your events to other relays and manage relay settings.
                </p>
            </div>

            <Tabs defaultValue="sync" className="space-y-6">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="sync">Sync Content</TabsTrigger>
                    <TabsTrigger value="relays">Relay Settings</TabsTrigger>
                </TabsList>

                {/* --- SYNC TAB --- */}
                <TabsContent value="sync" className="space-y-6">
                    {/* Backup info banner */}
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-1">
                        <p className="text-sm font-medium">Backup & Sync</p>
                        <p className="text-sm text-muted-foreground">
                            Use <strong>Check My Backup</strong> to see how many of your events are on the source relay.
                            Then set a target relay and click <strong>Start Sync</strong> to copy them — that's your backup.
                        </p>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Source Relay */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Source Relay</CardTitle>
                                <CardDescription>Where to fetch your notes from</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Select value={sourceRelay} onValueChange={setSourceRelay}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a relay" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {getRelayOptions().map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {sourceRelay === 'custom' && (
                                    <Input
                                        placeholder="wss://..."
                                        value={customSource}
                                        onChange={e => setCustomSource(e.target.value)}
                                    />
                                )}
                            </CardContent>
                        </Card>

                        {/* Target Relay */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Target Relay</CardTitle>
                                <CardDescription>Where to send your notes to</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Select value={targetRelay} onValueChange={setTargetRelay}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a relay" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {getRelayOptions().map(opt => (
                                            <SelectItem key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {targetRelay === 'custom' && (
                                    <Input
                                        placeholder="wss://..."
                                        value={customTarget}
                                        onChange={e => setCustomTarget(e.target.value)}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Time Range */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Time Range</CardTitle>
                            <CardDescription>Select the time period to sync notes from</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="use-time-range">Limit to time range</Label>
                                <Switch
                                    id="use-time-range"
                                    checked={useTimeRange}
                                    onCheckedChange={setUseTimeRange}
                                />
                            </div>
                            {useTimeRange && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <Label>Since (hours ago)</Label>
                                        <Input
                                            type="number"
                                            value={sinceHours}
                                            onChange={e => setSinceHours(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Until (hours ago)</Label>
                                        <Input
                                            type="number"
                                            value={untilHours}
                                            onChange={e => setUntilHours(Number(e.target.value))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Select Date Range</Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full justify-start text-left font-normal",
                                                        !dateRange && "text-muted-foreground"
                                                    )}
                                                >
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {dateRange?.from ? (
                                                        dateRange.to ? (
                                                            <>
                                                                {format(dateRange.from, "LLL dd, y")} -{" "}
                                                                {format(dateRange.to, "LLL dd, y")}
                                                            </>
                                                        ) : (
                                                            format(dateRange.from, "LLL dd, y")
                                                        )
                                                    ) : (
                                                        <span>Pick a date</span>
                                                    )}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    autoFocus
                                                    mode="range"
                                                    defaultMonth={dateRange?.from}
                                                    selected={dateRange}
                                                    onSelect={handleDateRangeSelect}
                                                    numberOfMonths={2}
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                </div>
                            )}
                            <div className="text-sm text-muted-foreground font-mono bg-muted/50 p-2 rounded">
                                <strong>Selected range:</strong> {getSelectedRangeText()}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Sync Configuration</CardTitle>
                            <CardDescription>Select what you want to sync and speed settings</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">

                            <div className="flex items-center justify-between space-x-2 border p-4 rounded-lg">
                                <div className="space-y-0.5">
                                    <Label className="text-base">Sync All Notes</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Copy every event found (may take longer)
                                    </p>
                                </div>
                                <Switch
                                    checked={syncAll}
                                    onCheckedChange={setSyncAll}
                                />
                            </div>

                            <div className="space-y-4 border p-4 rounded-lg bg-card/50">
                                <div className="flex flex-col space-y-2">
                                    <Label className="text-base">Sync Speed</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Controls the delay between each event sent. Slower speeds prevent "Rate Limit" errors from strict relays.
                                    </p>
                                </div>
                                <div className="space-y-3 pt-2">
                                    <div className="flex items-center space-x-4">
                                        <span className="text-xs font-bold text-muted-foreground w-8 text-right">FAST</span>
                                        <Slider
                                            value={[syncDelay]}
                                            max={1000}
                                            step={50}
                                            onValueChange={(val) => setSyncDelay(val[0])}
                                            className="flex-1"
                                        />
                                        <span className="text-xs font-bold text-muted-foreground w-8">SLOW</span>

                                        <div className="w-24 font-mono text-sm text-right border p-1.5 rounded bg-background shadow-sm">
                                            {syncDelay} ms
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-center text-xs">
                                        <span className={cn(
                                            "transition-colors font-medium",
                                            syncDelay === 0 ? "text-destructive" :
                                                syncDelay < 200 ? "text-amber-500" :
                                                    "text-green-500"
                                        )}>
                                            {syncDelay === 0 ? "⚠️ No Delay (Highest Risk)" :
                                                syncDelay < 200 ? "⚡ Minimal Delay (Standard)" :
                                                    "🛡️ Safe Mode (Recommended for Rate Limits)"}
                                        </span>
                                        <span className="text-muted-foreground">
                                            Approx. {syncDelay === 0 ? "100+" : Math.floor(1000 / Math.max(50, syncDelay))} events/sec
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {!syncAll && (
                                <div className="space-y-4">
                                    <Label>Select Kinds</Label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {SYNC_KINDS.map((item) => (
                                            <div
                                                key={item.kind}
                                                className="flex items-start space-x-3 space-y-0 rounded-md border p-4 hover:bg-accent cursor-pointer"
                                                onClick={() => handleKindToggle(item.kind)}
                                            >
                                                <Checkbox
                                                    checked={selectedKinds.includes(item.kind)}
                                                    onCheckedChange={() => handleKindToggle(item.kind)}
                                                />
                                                <div className="space-y-1 leading-none">
                                                    <Label className="cursor-pointer">
                                                        {item.label} <span className="text-xs text-muted-foreground">(Kind {item.kind})</span>
                                                    </Label>
                                                    <p className="text-xs text-muted-foreground">
                                                        {item.description}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-3">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    onClick={handleCheckBackup}
                                    disabled={isSyncing || !user}
                                    title={!user ? "Please login to check" : "Count your events on the source relay"}
                                >
                                    {isSyncing ? (
                                        <>
                                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                            Checking...
                                        </>
                                    ) : (
                                        <>
                                            <Wifi className="mr-2 h-4 w-4" />
                                            Check My Backup
                                        </>
                                    )}
                                </Button>

                                <Button
                                    className="w-full md:w-auto md:min-w-[200px]"
                                    size="lg"
                                    onClick={handleSync}
                                    disabled={isSyncing || !user}
                                    title={!user ? "Please login to sync" : "Start Sync"}
                                >
                                    {isSyncing ? (
                                        <>
                                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                            Syncing...
                                        </>
                                    ) : !user ? (
                                        <>
                                            <XCircle className="mr-2 h-4 w-4" />
                                            Login Required
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                            Start Sync
                                        </>
                                    )}
                                </Button>
                            </div>

                        </CardContent>
                    </Card>

                    {/* Terminal / Progress */}
                    {(isSyncing || logs.length > 0) && (
                        <Card ref={statusRef} className="bg-slate-950 text-slate-50 border-slate-800">
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm font-mono uppercase tracking-wider text-slate-400">Sync Status</CardTitle>
                                    <div className="flex items-center gap-4 text-sm font-mono">
                                        <span className="text-blue-400">Fetched: {stats.fetched}</span>
                                        <span className="text-green-400">Published: {stats.published}</span>
                                        {stats.errors > 0 && <span className="text-red-400">Errors: {stats.errors}</span>}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <Progress value={progress} className="h-2 bg-slate-800" />

                                    <ScrollArea className="h-[200px] w-full rounded-md border border-slate-800 bg-slate-900 p-4 font-mono text-xs">
                                        <div className="space-y-1">
                                            {logs.map((log, i) => (
                                                <div key={i} className={`flex items-start gap-2 ${log.type === 'error' ? 'text-red-400' :
                                                    log.type === 'success' ? 'text-green-400' :
                                                        'text-slate-300'
                                                    }`}>
                                                    <span className="text-slate-600 shrink-0">
                                                        [{new Date(log.timestamp).toLocaleTimeString()}]
                                                    </span>
                                                    <span>{log.message}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* --- RELAYS TAB --- */}
                <TabsContent value="relays" className="space-y-6">
                    <Card className="border-2 border-primary/10 shadow-lg">
                        <CardHeader className="space-y-1">
                            <CardTitle className="text-2xl">Relay Management</CardTitle>
                            <CardDescription>
                                Drag to reorder your preferred relays. The top relay is prioritized for searching and publishing.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-8">
                            <div className="space-y-4">
                                <Label htmlFor="relay-url" className="text-base font-semibold">Add New Relay</Label>
                                <div className="flex gap-3">
                                    <Input
                                        id="relay-url"
                                        className="h-12 border-2 focus-visible:ring-primary"
                                        placeholder="wss://relay.example.com"
                                        value={newRelayUrl}
                                        onChange={(e) => setNewRelayUrl(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddRelay()}
                                    />
                                    <Button onClick={handleAddRelay} size="lg" className="px-6 font-bold shadow-md hover:shadow-lg transition-all">
                                        <Plus className="h-5 w-5 mr-2" />
                                        Add
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <Label className="text-base font-semibold">Current Relays</Label>
                                    <Button variant="outline" size="sm" onClick={handleRestoreDefaults} className="text-xs hover:bg-primary hover:text-primary-foreground font-semibold">
                                        Restore Defaults
                                    </Button>
                                </div>

                                <div className="border-2 border-muted overflow-hidden rounded-xl shadow-inner bg-muted/30">
                                    {relays.length === 0 ? (
                                        <div className="p-12 text-center text-muted-foreground">
                                            <Wifi className="h-12 w-12 mx-auto mb-4 opacity-20 animate-pulse" />
                                            <p className="text-lg">No relays configured.</p>
                                            <Button variant="link" onClick={handleRestoreDefaults} className="mt-2 text-primary font-bold">
                                                Load default relays
                                            </Button>
                                        </div>
                                    ) : (
                                        <DndContext
                                            sensors={sensors}
                                            collisionDetection={closestCenter}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <SortableContext
                                                items={relays.map((r) => r.url)}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                <div className="divide-y-2 divide-muted">
                                                    {relays.map((relay) => (
                                                        <SortableRelayItem
                                                            key={relay.url}
                                                            relay={relay}
                                                            onRemove={handleRemoveRelay}
                                                        />
                                                    ))}
                                                </div>
                                            </SortableContext>
                                        </DndContext>
                                    )}
                                </div>
                            </div>

                            {config.relayMetadata?.updatedAt > 0 && (
                                <div className="flex items-center gap-3 p-4 bg-primary/5 text-primary rounded-xl text-sm border-2 border-primary/10 shadow-sm transition-all hover:bg-primary/10">
                                    <Check className="h-5 w-5" />
                                    <span className="font-medium">Relay list synced from your Nostr profile on {new Date(config.relayMetadata.updatedAt * 1000).toLocaleString()}</span>
                                </div>
                            )}

                            <div className="mt-6 p-5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl text-sm border-2 border-amber-500/20 flex gap-4 items-start shadow-sm">
                                <AlertTriangle className="h-6 w-6 shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                    <p className="font-bold text-base">Performance Tip</p>
                                    <p className="opacity-90">
                                        These relays are used to fetch your profile and settings.
                                        Adding too many relays may slow down the application. We recommend keeping it under 5.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
