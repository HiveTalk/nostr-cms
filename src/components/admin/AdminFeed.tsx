import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Save, Rss, Trash2, UserPlus, Lock } from 'lucide-react';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRemoteNostrJson } from '@/hooks/useRemoteNostrJson';
import { getMasterPubkey } from '@/lib/relay';
import { buildSiteConfigTags } from '@/lib/siteConfig';
import { formatPubkey } from '@/lib/utils';
import { useAuthor } from '@/hooks/useAuthor';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { User } from 'lucide-react';

function FeedSourceItem({ npub, onRemove, disabled }: { npub: string; onRemove: (npub: string) => void; disabled: boolean }) {
  const { data } = useAuthor(npub);
  const metadata = data?.metadata;

  return (
    <div className="flex items-center justify-between p-3 bg-card/50">
      <div className="flex items-center gap-3 overflow-hidden mr-2">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={metadata?.picture} alt={metadata?.name || npub} />
          <AvatarFallback>
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col overflow-hidden">
          <span className="text-sm font-medium truncate">
            {metadata?.name || metadata?.display_name || 'Anonymous'}
          </span>
          <span className="text-xs text-muted-foreground font-mono truncate">
            {formatPubkey(npub)}
          </span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onRemove(npub)}
      >
        <Trash2 className={`h-4 w-4 ${disabled ? 'text-muted-foreground' : 'text-destructive'}`} />
      </Button>
    </div>
  );
}

function DirectorySelectItem({ name, pubkey }: { name: string; pubkey: string }) {
  const { data } = useAuthor(pubkey);
  const metadata = data?.metadata;

  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarImage src={metadata?.picture} alt={metadata?.name || name} />
        <AvatarFallback>
          <User className="h-3 w-3" />
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <span className="font-medium text-sm">{name}</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {formatPubkey(pubkey)}
        </span>
      </div>
    </div>
  );
}

export default function AdminFeed() {
  const { config, updateConfig } = useAppContext();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [isSaving, setIsSaving] = useState(false);
  const [feedNpubs, setFeedNpubs] = useState<string[]>(config.siteConfig?.feedNpubs || []);
  const [readFromPublishRelays, setReadFromPublishRelays] = useState(config.siteConfig?.feedReadFromPublishRelays || false);
  const [newNpub, setNewNpub] = useState('');
  const { data: remoteNostrJson } = useRemoteNostrJson();

  useEffect(() => {
    if (config.siteConfig) {
      setFeedNpubs(config.siteConfig.feedNpubs || []);
      setReadFromPublishRelays(config.siteConfig.feedReadFromPublishRelays || false);
    }
  }, [config.siteConfig]);

  const masterPubkey = getMasterPubkey();
  const userPubkey = user?.pubkey.toLowerCase().trim();
  const isMaster = userPubkey === masterPubkey;
  const adminRoles = config.siteConfig?.adminRoles || {};
  const userRole = userPubkey ? adminRoles[userPubkey] : undefined;

  const canManageFeed = isMaster || userRole === 'publisher';

  const handleSave = async () => {
    if (!canManageFeed) return;
    setIsSaving(true);
    try {
      const currentConfig = config.siteConfig || {};
      const updatedConfig = {
        ...currentConfig,
        feedNpubs,
        feedReadFromPublishRelays: readFromPublishRelays,
        updatedAt: Math.floor(Date.now() / 1000),
      };

      // We need to publish the entire site config because it's a replaceable event
      const configTags = buildSiteConfigTags(updatedConfig);

      await publishEvent({
        event: {
          kind: 30078,
          content: JSON.stringify({ navigation: config.navigation }),
          tags: configTags,
        }
      });

      updateConfig((prev) => ({
        ...prev,
        siteConfig: updatedConfig,
      }));

      queryClient.clear();
      toast({
        title: "Settings Saved",
        description: "Feed configuration has been updated successfully.",
      });
    } catch (error) {
      console.error('Failed to save feed settings:', error);
      toast({
        title: "Error",
        description: "Failed to save feed settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Feed Management</h2>
          <p className="text-muted-foreground">
            Configure which Nostr users appear in your community feed.
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || !user || !canManageFeed}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {!canManageFeed && (
        <div className="flex items-center gap-2 p-4 border rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800">
          <Lock className="h-5 w-5 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-bold">Restricted Access:</span> Only Master and Primary Admins can modify feed sources.
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rss className="h-5 w-5 text-primary" />
            Feed Sources
          </CardTitle>
          <CardDescription>
            Configure the sources for your community feed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Add from Directory</Label>
              <CardDescription>
                Select users from your community directory (nostr.json) to add to the feed.
              </CardDescription>
              <div className="flex gap-2">
                <Select
                  disabled={!canManageFeed}
                  onValueChange={(pubkey) => {
                    if (pubkey && !feedNpubs.includes(pubkey)) {
                      setFeedNpubs(prev => [...prev, pubkey]);
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a user to add..." />
                  </SelectTrigger>
                  <SelectContent>
                    {remoteNostrJson?.names && Object.entries(remoteNostrJson.names)
                      .filter(([_, pubkey]) => !!(pubkey as string) && !feedNpubs.includes(pubkey as string))
                      .map(([name, pubkey]) => (
                        <SelectItem key={pubkey as string} value={pubkey as string}>
                          <DirectorySelectItem name={name} pubkey={pubkey as string} />
                        </SelectItem>
                      ))}
                    {(!remoteNostrJson?.names ||
                      Object.entries(remoteNostrJson.names).filter(([_, pubkey]) => !feedNpubs.includes(pubkey as string)).length === 0) && (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          No more users to add from directory.
                        </div>
                      )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="manualNpub">Add Manual npub</Label>
              <CardDescription>
                Add a specific Nostr public key (npub) to the feed sources.
              </CardDescription>
              <div className="flex gap-2 flex-wrap">
                <Input
                  id="manualNpub"
                  value={newNpub}
                  onChange={(e) => setNewNpub(e.target.value)}
                  placeholder="npub1..."
                  className="flex-1"
                  disabled={!canManageFeed}
                />
                <Button
                  type="button"
                  disabled={!canManageFeed}
                  onClick={() => {
                    if (newNpub.trim()) {
                      setFeedNpubs(prev => [...new Set([...prev, newNpub.trim()])]);
                      setNewNpub('');
                    }
                  }}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Current Feed Sources</Label>
              <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
                {feedNpubs.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No feed sources added yet.
                  </div>
                ) : (
                  feedNpubs.filter(npub => !!npub).map((npub) => (
                    <FeedSourceItem
                      key={npub}
                      npub={npub}
                      disabled={!canManageFeed}
                      onRemove={(n) => setFeedNpubs(prev => prev.filter(item => item !== n))}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div className="space-y-0.5">
              <Label className="text-base">Read from Publishing Relays</Label>
              <CardDescription>
                Also fetch notes from the publishing relays defined in Site Settings.
              </CardDescription>
            </div>
            <Switch
              checked={readFromPublishRelays}
              onCheckedChange={setReadFromPublishRelays}
              disabled={!canManageFeed}
            />
          </div>

          <div className="flex items-start gap-3 p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Note on Interactivity</p>
              <p className="mt-1">
                Any Nostr user visiting the public /feed page will be able to react, reply, zap, or bookmark these notes if they are logged in.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
