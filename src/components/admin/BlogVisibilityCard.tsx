import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Save, Trash2, UserPlus, User, ChevronDown, Eye } from 'lucide-react';
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

function AuthorListItem({ npub, onRemove, disabled }: { npub: string; onRemove: (npub: string) => void; disabled: boolean }) {
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

/**
 * Controls which authors' blog posts (kind 30023) appear on the public site.
 * When the allowlist is empty, posts from the master account and users with
 * the publisher role are shown — the historical behavior. Once at least one
 * author is listed, only their posts appear; the author need not hold an
 * admin role (e.g. an org account posting on a community relay).
 */
export function BlogVisibilityCard() {
  const { config, updateConfig } = useAppContext();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [blogNpubs, setBlogNpubs] = useState<string[]>(config.siteConfig?.blogNpubs || []);
  const [newNpub, setNewNpub] = useState('');
  const { data: remoteNostrJson } = useRemoteNostrJson();

  useEffect(() => {
    setBlogNpubs(config.siteConfig?.blogNpubs || []);
  }, [config.siteConfig?.blogNpubs]);

  const masterPubkey = getMasterPubkey();
  const userPubkey = user?.pubkey.toLowerCase().trim();
  const adminRoles = config.siteConfig?.adminRoles || {};
  const canManage = userPubkey === masterPubkey || adminRoles[userPubkey ?? ''] === 'publisher';

  const handleSave = async () => {
    if (!canManage) return;
    setIsSaving(true);
    try {
      const updatedConfig = {
        ...(config.siteConfig || {}),
        blogNpubs,
        updatedAt: Math.floor(Date.now() / 1000),
      };

      // Publish the entire site config — the event is replaceable.
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
        title: 'Settings Saved',
        description: 'Blog post visibility has been updated.',
      });
    } catch (error) {
      console.error('Failed to save blog visibility settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                Blog Post Visibility
                {blogNpubs.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    ({blogNpubs.length} author{blogNpubs.length === 1 ? '' : 's'} allowed)
                  </span>
                )}
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </CardTitle>
            <CardDescription>
              {blogNpubs.length === 0
                ? 'Showing posts from the master account and publishers (default).'
                : 'Only listed authors\' posts appear on the public blog pages.'}
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Add from Directory</Label>
              <CardDescription>
                Select users from your community directory (nostr.json) to allow their blog posts.
              </CardDescription>
              <Select
                disabled={!canManage}
                onValueChange={(pubkey) => {
                  if (pubkey && !blogNpubs.includes(pubkey)) {
                    setBlogNpubs(prev => [...prev, pubkey]);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a user to add..." />
                </SelectTrigger>
                <SelectContent>
                  {remoteNostrJson?.names && Object.entries(remoteNostrJson.names)
                    .filter(([_, pubkey]) => !!(pubkey as string) && !blogNpubs.includes(pubkey as string))
                    .map(([name, pubkey]) => (
                      <SelectItem key={pubkey as string} value={pubkey as string}>
                        <DirectorySelectItem name={name} pubkey={pubkey as string} />
                      </SelectItem>
                    ))}
                  {(!remoteNostrJson?.names ||
                    Object.entries(remoteNostrJson.names).filter(([_, pubkey]) => !blogNpubs.includes(pubkey as string)).length === 0) && (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No more users to add from directory.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manualBlogNpub">Add Manual npub</Label>
              <div className="flex gap-2 flex-wrap">
                <Input
                  id="manualBlogNpub"
                  value={newNpub}
                  onChange={(e) => setNewNpub(e.target.value)}
                  placeholder="npub1..."
                  className="flex-1"
                  disabled={!canManage}
                />
                <Button
                  type="button"
                  disabled={!canManage}
                  onClick={() => {
                    if (newNpub.trim()) {
                      setBlogNpubs(prev => [...new Set([...prev, newNpub.trim()])]);
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
              <Label>Allowed Blog Authors</Label>
              <div className="border rounded-md divide-y max-h-[300px] overflow-y-auto">
                {blogNpubs.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No restrictions — master account and publisher posts are shown.
                  </div>
                ) : (
                  blogNpubs.filter(npub => !!npub).map((npub) => (
                    <AuthorListItem
                      key={npub}
                      npub={npub}
                      disabled={!canManage}
                      onRemove={(n) => setBlogNpubs(prev => prev.filter(item => item !== n))}
                    />
                  ))
                )}
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Applies to the public /blog page and homepage blog section. Admin views always list all posts.
              </p>
              <Button
                onClick={handleSave}
                disabled={isSaving || !user || !canManage}
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default BlogVisibilityCard;
