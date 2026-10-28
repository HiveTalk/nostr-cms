/**
 * AdminCrosspost - Connect an X (Twitter) account and auto-crosspost notes
 *
 * Backed by the Swarm relay's /api/x endpoints: the relay runs the OAuth
 * 1.0a flow, stores the user tokens, and posts every kind-1 note authored by
 * the linked account — covering both live websocket publishes and scheduled
 * publishes. This page only manages the link and the on/off switch.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useXStatus, useXConnect, useXDisconnect, useXToggle } from '@/hooks/useXAccount';
import {
  Share2,
  Loader2,
  Link2,
  Unlink,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Info,
} from 'lucide-react';
import { format } from 'date-fns';

const X_ERROR_MESSAGES: Record<string, string> = {
  expired: 'The X authorization session expired. Please try connecting again.',
  unconfigured: 'The server lost its X crossposting configuration. Ask the site operator to check XPOST_SERVICE_URL or TWITTER_KEY.',
  exchange: 'Could not complete the X authorization token exchange.',
  store: 'Authorization succeeded but the server failed to save the account.',
  notify: 'X authorization succeeded but the relay could not record the link. Try connecting again.',
  internal: 'The crossposting service hit an internal error. Try connecting again.',
};

export default function AdminCrosspost() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusQuery = useXStatus();
  const connect = useXConnect();
  const disconnect = useXDisconnect();
  const toggle = useXToggle();

  const status = statusQuery.data;

  // Surface OAuth redirect results (?x_linked=1, ?x_denied=1, ?x_error=<code>)
  // once, then strip the params from the URL.
  useEffect(() => {
    const linked = searchParams.get('x_linked');
    const denied = searchParams.get('x_denied');
    const error = searchParams.get('x_error');
    if (!linked && !denied && !error) return;

    if (linked) {
      toast({ title: 'X account connected', description: 'Your notes will now crosspost to X.' });
    } else if (denied) {
      toast({ title: 'X connection cancelled', description: 'You denied access on X — nothing was linked.', variant: 'destructive' });
    } else if (error) {
      toast({
        title: 'X connection failed',
        description: X_ERROR_MESSAGES[error] ?? `Unexpected error: ${error}`,
        variant: 'destructive',
      });
    }

    searchParams.delete('x_linked');
    searchParams.delete('x_denied');
    searchParams.delete('x_error');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, toast]);

  if (!user) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Crossposting</h2>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Please log in to manage X crossposting.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleConnect = () => {
    connect.mutate(undefined, {
      onError: (err) => {
        toast({
          title: 'Could not start X authorization',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Crossposting</h2>
        <p className="text-muted-foreground">
          Connect your X account to automatically post your notes to X.
        </p>
      </div>

      {statusQuery.isLoading && (
        <Card>
          <CardContent className="pt-6 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking crossposting status…
          </CardContent>
        </Card>
      )}

      {status && !status.available && (
        <Card>
          <CardContent className="pt-6 flex items-start gap-3 text-sm">
            <Info className="h-5 w-5 mt-0.5 text-blue-500" />
            <div>
              <p className="font-medium">Crossposting not available</p>
              <p className="text-muted-foreground">
                This relay does not expose the crossposting API. It requires a
                Swarm relay build that includes the <code>/api/x</code> endpoints.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status?.available && status.unauthorized && (
        <Card>
          <CardContent className="pt-6 flex items-start gap-3 text-sm">
            <AlertTriangle className="h-5 w-5 mt-0.5 text-amber-500" />
            <div>
              <p className="font-medium">Not a relay team member</p>
              <p className="text-muted-foreground">
                Your account can administer the CMS but isn't in the relay's{' '}
                <code>nostr.json</code> member list, so it can't link an X
                account. Ask the relay operator to add your pubkey.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status?.available && !status.unauthorized && !status.configured && (
        <Card>
          <CardContent className="pt-6 flex items-start gap-3 text-sm">
            <AlertTriangle className="h-5 w-5 mt-0.5 text-amber-500" />
            <div>
              <p className="font-medium">X crossposting not configured</p>
              <p className="text-muted-foreground">
                The site operator needs to point the relay at a crossposting
                service with <code>XPOST_SERVICE_URL</code>, or set{' '}
                <code>TWITTER_KEY</code> and <code>TWITTER_KEY_SECRET</code>{' '}
                (X developer app consumer credentials) to run the flow on the
                relay itself.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status?.available && !status.unauthorized && status.configured && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Share2 className="h-4 w-4" />
              X Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!status.linked ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Authorize this site to post to your X account. You'll be sent
                  to X to approve access, then returned here.
                </p>
                <Button onClick={handleConnect} disabled={connect.isPending}>
                  {connect.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4 mr-2" />
                  )}
                  Connect X Account
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        @{status.screen_name ?? status.twitter_user_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Linked {status.linked_at ? format(new Date(status.linked_at), 'MMM d, yyyy') : ''}
                      </p>
                    </div>
                    <Badge variant={status.enabled ? 'default' : 'secondary'}>
                      {status.enabled ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={disconnect.isPending}>
                        {disconnect.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Unlink className="h-4 w-4 mr-2" />
                        )}
                        Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect X account?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Your notes will stop crossposting to @{status.screen_name}.
                          The stored access tokens are deleted from the server.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            disconnect.mutate(undefined, {
                              onError: (err) =>
                                toast({
                                  title: 'Disconnect failed',
                                  description: err instanceof Error ? err.message : 'Unknown error',
                                  variant: 'destructive',
                                }),
                            })
                          }
                        >
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="x-enabled" className="text-sm font-medium">
                      Auto-post notes to X
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Every kind-1 note you publish to this relay — including
                      scheduled ones — is posted to X.
                    </p>
                  </div>
                  <Switch
                    id="x-enabled"
                    checked={status.enabled ?? false}
                    disabled={toggle.isPending}
                    onCheckedChange={(checked) =>
                      toggle.mutate(checked, {
                        onError: (err) =>
                          toast({
                            title: 'Could not update setting',
                            description: err instanceof Error ? err.message : 'Unknown error',
                            variant: 'destructive',
                          }),
                      })
                    }
                  />
                </div>

                {(status.last_posted_at || status.last_error) && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {status.last_posted_at && (
                      <p>
                        Last crossposted:{' '}
                        {format(new Date(status.last_posted_at), 'MMM d, yyyy · h:mm a')}
                      </p>
                    )}
                    {status.last_error && (
                      <p className="text-destructive">Last error: {status.last_error}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Once linked and enabled, every <strong>kind-1 note</strong> you
            publish to this relay is automatically posted to X — including notes
            published by the scheduler at their scheduled time.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code>nostr:npub…</code>, <code>nostr:note…</code> and other nostr
              references become readable <code>nostr.at</code> links.
            </li>
            <li>
              Each tweet ends with a link back to the original note on{' '}
              <a
                href="https://nostr.at"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                nostr.at <ExternalLink className="h-3 w-3" />
              </a>
              .
            </li>
            <li>Replies and reposts are never crossposted.</li>
            <li>Blog posts (long-form) are never crossposted.</li>
            <li>Over-length notes are truncated at a word boundary; the source link is always kept.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
