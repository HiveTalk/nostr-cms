import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAdminAuth } from '@/hooks/useRemoteNostrJson';
import { useToast } from '@/hooks/useToast';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useAppContext } from '@/hooks/useAppContext';
import { getSwarmAdminApiUrl, isUnifiedSetup } from '@/lib/relay';
import { buildSiteConfigTags } from '@/lib/siteConfig';
import { nip98Fetch } from '@/lib/nip98';
import { AlertTriangle, RefreshCw, ShieldAlert, Trash2, UserPlus, Crown } from 'lucide-react';

interface RelayUsersResponse {
  users: Record<string, string>;
  isRemote: boolean;
  npubDomain?: string;
}

interface RelayUser {
  name: string;
  pubkey: string;
}

function dedupeUsersByPubkey(entries: RelayUser[]): RelayUser[] {
  const byPubkey = new Map<string, RelayUser>();

  for (const entry of entries) {
    const normalizedPubkey = entry.pubkey.toLowerCase().trim();
    const normalizedEntry = {
      name: entry.name,
      pubkey: normalizedPubkey,
    };

    const existing = byPubkey.get(normalizedPubkey);
    if (!existing) {
      byPubkey.set(normalizedPubkey, normalizedEntry);
      continue;
    }

    const existingIsRootAlias = existing.name.trim() === '_';
    const incomingIsRootAlias = normalizedEntry.name.trim() === '_';
    if (!existingIsRootAlias && incomingIsRootAlias) {
      byPubkey.set(normalizedPubkey, normalizedEntry);
    }
  }

  return Array.from(byPubkey.values());
}

function normalizePubkey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'npub') throw new Error('Invalid npub key');
    return String(decoded.data).toLowerCase();
  }

  return trimmed.toLowerCase();
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  return text || `${response.status} ${response.statusText}`;
}

export default function AdminRelayAccess() {
  const { user } = useCurrentUser();
  const { isMaster: isMasterUser, masterPubkey } = useAdminAuth(user?.pubkey);
  const { toast } = useToast();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { config, updateConfig } = useAppContext();

  const [users, setUsers] = useState<RelayUser[]>([]);
  const [isRemote, setIsRemote] = useState(false);
  const [npubDomain, setNpubDomain] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPubkey, setNewPubkey] = useState('');

  const [editingPubkey, setEditingPubkey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [updatingRolePubkey, setUpdatingRolePubkey] = useState<string | null>(null);

  const adminRoles = config.siteConfig?.adminRoles ?? {};

  // Change a user's CMS role (primary/secondary) and publish the updated
  // site config event so the change persists across browsers and reloads.
  const handleChangeRole = async (pubkey: string, role: 'publisher' | 'user') => {
    setUpdatingRolePubkey(pubkey);
    try {
      const normalizedPk = pubkey.toLowerCase().trim();
      const currentConfig = config.siteConfig || {};
      const updatedAdminRoles = {
        ...currentConfig.adminRoles,
        [normalizedPk]: role,
      };

      // Update localStorage immediately so the UI reflects the change
      updateConfig(prev => ({
        ...prev,
        siteConfig: {
          ...(prev.siteConfig || {}),
          adminRoles: updatedAdminRoles,
        },
      }));

      // Publish the updated site config as a 30078 event
      const configTags = buildSiteConfigTags({ ...currentConfig, adminRoles: updatedAdminRoles });

      await publishEvent({
        event: {
          kind: 30078,
          content: JSON.stringify({ navigation: config.navigation || [] }),
          tags: configTags,
        },
      });

      toast({
        title: 'Role updated',
        description: `User is now ${role === 'publisher' ? 'a primary admin' : 'a secondary admin'}.`,
      });
    } catch (error) {
      toast({
        title: 'Failed to update role',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setUpdatingRolePubkey(null);
    }
  };

  const unified = isUnifiedSetup();
  const adminApiBase = getSwarmAdminApiUrl();
  const adminApiBases = useMemo(() => {
    const primary = adminApiBase.replace(/\/$/, '');
    const legacy = primary.endsWith('/admin')
      ? `${primary.slice(0, -'/admin'.length)}/dashboard`
      : '';

    return legacy && legacy !== primary ? [primary, legacy] : [primary];
  }, [adminApiBase]);

  // Each request is individually NIP-98-signed by the user's signer —
  // replaces the cookie-session flow (which POSTed a bare pubkey to /login
  // with no proof of key possession). Writes sign like reads.
  //
  // Backends that predate NIP-98 admin auth reject signed requests with 401 —
  // fall back to the session-cookie flow so the panel keeps working until the
  // relay is upgraded. The mode is remembered per base so legacy backends
  // don't trigger a signing prompt on every request.
  const sessionBackedBases = useRef<Set<string>>(new Set());

  const ensureAdminSession = useCallback(async (base: string): Promise<void> => {
    if (!user?.pubkey) throw new Error('Please login with the primary owner key first');
    const loginResponse = await fetch(`${base}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: user.pubkey.toLowerCase().trim() }),
    });
    if (!loginResponse.ok) throw new Error(await parseError(loginResponse));
  }, [user?.pubkey]);

  const fetchAdminApi = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    if (!user?.pubkey) throw new Error('Please login with the primary owner key first');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    for (let index = 0; index < adminApiBases.length; index++) {
      const base = adminApiBases[index];
      let response: Response;
      if (sessionBackedBases.current.has(base)) {
        response = await fetch(`${base}${normalizedPath}`, { credentials: 'include', ...init });
        if (response.status === 401) {
          await ensureAdminSession(base);
          response = await fetch(`${base}${normalizedPath}`, { credentials: 'include', ...init });
        }
      } else {
        response = await nip98Fetch(`${base}${normalizedPath}`, init, user);
        if (response.status === 401) {
          await ensureAdminSession(base);
          response = await fetch(`${base}${normalizedPath}`, { credentials: 'include', ...init });
          if (response.status !== 401) sessionBackedBases.current.add(base);
        }
      }
      if (response.status !== 404 || index === adminApiBases.length - 1) {
        return response;
      }
    }
    throw new Error('Unable to reach relay admin API');
  }, [adminApiBases, ensureAdminSession, user]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.name === '_') return -1;
      if (b.name === '_') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [users]);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetchAdminApi('/users', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const data = await response.json() as RelayUsersResponse;
      const fetchedUsers = Object.entries(data.users || {}).map(([name, pubkey]) => ({ name, pubkey }));
      setUsers(dedupeUsersByPubkey(fetchedUsers));
      setIsRemote(data.isRemote);
      setNpubDomain(data.npubDomain || '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load relay users';
      toast({
        title: 'Failed to load relay access',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [fetchAdminApi, toast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleAddUser = async () => {
    if (!newName.trim() || !newPubkey.trim()) return;

    try {
      setIsSubmitting(true);

      const pubkey = normalizePubkey(newPubkey);
      if (pubkey.length !== 64 || !/^[a-f0-9]+$/i.test(pubkey)) {
        throw new Error('Pubkey must be 64-char hex or a valid npub');
      }

      const response = await fetchAdminApi('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          pubkey,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      toast({
        title: 'User added',
        description: `${newName.trim()} was added to relay access`,
      });

      setNewName('');
      setNewPubkey('');
      await loadUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add user';
      toast({
        title: 'Failed to add user',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransferMaster = async (pubkey: string, name: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to make ${name} the primary owner? This will transfer master access and you may lose owner permissions.`
    );
    if (!confirmed) return;

    try {
      setIsSubmitting(true);

      const response = await fetchAdminApi(`/user/${pubkey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '_' }),
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      toast({
        title: 'Primary owner updated',
        description: `${name} is now the primary owner. You may need to re-login with the new owner key.`,
      });

      setEditingPubkey(null);
      setEditingName('');
      await loadUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to transfer primary owner';
      toast({
        title: 'Failed to transfer primary owner',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (pubkey: string, name: string) => {
    setEditingPubkey(pubkey);
    setEditingName(name);
  };

  const handleSaveEdit = async () => {
    if (!editingPubkey || !editingName.trim()) return;

    try {
      setIsSubmitting(true);

      const response = await fetchAdminApi(`/user/${editingPubkey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName.trim() }),
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      toast({
        title: 'User updated',
        description: 'Relay access entry updated',
      });

      setEditingPubkey(null);
      setEditingName('');
      await loadUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update user';
      toast({
        title: 'Failed to update user',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (pubkey: string, name: string) => {
    if (!window.confirm(`Remove ${name} from relay access?`)) return;

    try {
      setIsSubmitting(true);

      const response = await fetchAdminApi(`/user/${pubkey}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      toast({
        title: 'User removed',
        description: `${name} was removed from relay access`,
      });

      await loadUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove user';
      toast({
        title: 'Failed to remove user',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!unified) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manage Relay Access</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-3 text-sm text-muted-foreground">
          <AlertTriangle className="h-5 w-5 mt-0.5" />
          <p>
            Relay access management is only available in unified setup where CMS and relay share the same domain.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isMasterUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manage Relay Access</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-3 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 mt-0.5 text-destructive" />
          <p>Only the primary owner can add or remove relay access users.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Manage Relay Access</h2>
          <p className="text-muted-foreground">Manage users in relay <code>nostr.json</code>.</p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void loadUsers()} disabled={isLoading || isSubmitting}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 flex items-start gap-3 text-sm">
          <ShieldAlert className="h-5 w-5 mt-0.5 text-blue-500" />
          <div>
            <p className="font-medium">Unified Setup Only</p>
            <p className="text-muted-foreground">
              This section is only visible when CMS and Swarm relay share the same domain.
              If you are running CMS and relay separately, this tab will not appear and
              relay access must be managed through your relay's external administration interface.
            </p>
          </div>
        </CardContent>
      </Card>

      {isRemote && (
        <Card>
          <CardContent className="pt-6 flex items-start gap-3 text-sm">
            <AlertTriangle className="h-5 w-5 mt-0.5 text-amber-500" />
            <div>
              <p className="font-medium">Relay uses remote nostr.json</p>
              <p className="text-muted-foreground">
                Direct writes are disabled by relay config.
                {npubDomain ? ` Source domain: ${npubDomain}` : ''}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add User</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="relay-access-name">Name</Label>
              <Input
                id="relay-access-name"
                placeholder="alice"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={isSubmitting || isRemote}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="relay-access-pubkey">Pubkey or npub</Label>
              <Input
                id="relay-access-pubkey"
                placeholder="npub1... or 64-char hex"
                value={newPubkey}
                onChange={(e) => setNewPubkey(e.target.value)}
                disabled={isSubmitting || isRemote}
              />
            </div>
          </div>

          <Button onClick={() => void handleAddUser()} disabled={isSubmitting || isRemote || !newName.trim() || !newPubkey.trim()}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Access List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading relay users...</p>
          ) : sortedUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users found.</p>
          ) : (
            sortedUsers.map((entry) => {
              const normalized = entry.pubkey.toLowerCase().trim();
              const isRoot = normalized === masterPubkey;

              return (
                <div key={entry.pubkey} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{entry.name}</span>
                        {isRoot && <Badge><Crown className="h-3 w-3 mr-1" />Primary Owner</Badge>}
                        {!isRoot && adminRoles[normalized] === 'publisher' && (
                          <Badge variant="secondary">Publisher</Badge>
                        )}
                        {!isRoot && adminRoles[normalized] === 'user' && (
                          <Badge variant="outline">User</Badge>
                        )}
                      </div>
                      <code className="text-xs break-all text-muted-foreground">{entry.pubkey}</code>
                    </div>

                    {!isRoot && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteUser(entry.pubkey, entry.name)}
                        disabled={isSubmitting || isRemote}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </Button>
                    )}
                  </div>

                  {!isRoot && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleTransferMaster(entry.pubkey, entry.name)}
                        disabled={isSubmitting || isRemote}
                      >
                        Make Primary Owner
                      </Button>
                      {editingPubkey === entry.pubkey ? (
                        <>
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            disabled={isSubmitting || isRemote}
                          />
                          <Button size="sm" onClick={() => void handleSaveEdit()} disabled={isSubmitting || isRemote || !editingName.trim()}>
                            Save
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingPubkey(null);
                              setEditingName('');
                            }}
                            disabled={isSubmitting}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEdit(entry.pubkey, entry.name)}
                          disabled={isSubmitting || isRemote}
                        >
                          Rename
                        </Button>
                      )}
                      {/* Role selector — lets the owner promote/demote
                          users between Publisher and User. Publishers'
                          content appears on the public site; Users can
                          back up events and see stats but their content
                          doesn't appear publicly. This publishes a new
                          30078 site config event with the updated
                          admin_roles tag. */}
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-muted-foreground">Role:</span>
                        <Select
                          value={adminRoles[normalized] || 'user'}
                          onValueChange={(value) => void handleChangeRole(normalized, value as 'publisher' | 'user')}
                          disabled={isSubmitting || isRemote || updatingRolePubkey === normalized}
                        >
                          <SelectTrigger className="w-[130px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="publisher">Publisher</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
