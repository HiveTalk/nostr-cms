import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/useToast';
import { fetchAiModels, type Model } from '@/hooks/useAiChat';
import {
  useAiSettings,
  useAiSettingsEvent,
  useAiProxyStatus,
  useSaveAiSettings,
  useClearAiSettings,
  type AiHelperAccess,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
} from '@/hooks/useAiSettings';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { buildSiteConfigTags } from '@/lib/siteConfig';
import { Bot, CheckCircle2, RefreshCw, Trash2, Users } from 'lucide-react';

/**
 * AI assistant provider settings (master user only). The API key is stored
 * NIP-44/NIP-04 encrypted in a kind 30078 event on the relay, so it survives
 * across devices without ever being readable by anyone else.
 */
export function AiSettingsSection({ isMasterUser }: { isMasterUser: boolean }) {
  const { toast } = useToast();
  const { config, updateConfig } = useAppContext();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { data: settingsEvent, isLoading: eventLoading } = useAiSettingsEvent();
  const { data: savedSettings } = useAiSettings();
  const { data: proxyStatus } = useAiProxyStatus();
  const saveSettings = useSaveAiSettings();
  const clearSettings = useClearAiSettings();

  const [baseUrl, setBaseUrl] = useState(DEFAULT_AI_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [models, setModels] = useState<Model[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isSavingAccess, setIsSavingAccess] = useState(false);

  const aiHelperAccess: AiHelperAccess = config.siteConfig?.aiHelperAccess ?? 'master';
  const proxyEnabled = !!proxyStatus?.enabled;

  /** Publish the site-config event with a new ai_helper_access value. */
  const handleAccessChange = async (value: AiHelperAccess) => {
    setIsSavingAccess(true);
    try {
      await publishEvent({
        event: {
          kind: 30078,
          content: JSON.stringify({ navigation: config.navigation }),
          tags: buildSiteConfigTags({ ...config.siteConfig, aiHelperAccess: value }),
        },
      });
      updateConfig((current) => ({
        ...current,
        siteConfig: {
          ...(current.siteConfig || {}),
          aiHelperAccess: value,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      }));
      toast({
        title: 'AI access updated',
        description: value === 'admins'
          ? 'All admins in nostr.json can now use the AI Helper via the server proxy.'
          : 'The AI Helper is restricted to the master user.',
      });
    } catch (err) {
      toast({
        title: 'Failed to update access',
        description: err instanceof Error ? err.message : 'Could not save the access setting.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingAccess(false);
    }
  };

  // Populate the form once the saved (decrypted) settings arrive.
  useEffect(() => {
    if (savedSettings) {
      setBaseUrl(savedSettings.baseUrl);
      setApiKey(savedSettings.apiKey);
      setModel(savedSettings.model);
    }
  }, [savedSettings]);

  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      toast({ title: 'API key required', description: 'Enter an API key before fetching models.', variant: 'destructive' });
      return;
    }
    setIsTesting(true);
    try {
      const response = await fetchAiModels(baseUrl.trim() || DEFAULT_AI_BASE_URL, apiKey.trim());
      setModels(response.data);
      toast({ title: 'Connected', description: `Found ${response.data.length} models.` });
    } catch (err) {
      setModels([]);
      toast({
        title: 'Connection failed',
        description: err instanceof Error ? err.message : 'Could not reach the provider.',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      await saveSettings.mutateAsync({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || DEFAULT_AI_BASE_URL,
        model: model.trim() || DEFAULT_AI_MODEL,
      });
      toast({
        title: 'AI settings saved',
        description: 'The AI Helper now appears in the admin menu.',
      });
    } catch (err) {
      toast({
        title: 'Failed to save',
        description: err instanceof Error ? err.message : 'Could not save AI settings.',
        variant: 'destructive',
      });
    }
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      await clearSettings.mutateAsync();
      setApiKey('');
      setModels([]);
      toast({ title: 'AI settings removed', description: 'The AI Helper is now hidden.' });
    } catch (err) {
      toast({
        title: 'Failed to remove',
        description: err instanceof Error ? err.message : 'Could not remove AI settings.',
        variant: 'destructive',
      });
    } finally {
      setIsRemoving(false);
    }
  };

  if (!isMasterUser) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Assistant
          {settingsEvent && (
            <Badge variant="default" className="bg-green-600 hover:bg-green-700 ml-2">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Configured
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Connect any OpenAI-compatible LLM provider. The API key is stored{' '}
          <b>encrypted</b> (NIP-44/NIP-04) as an event on your relay — only you
          can decrypt it. Once saved, the <b>AI Helper</b> appears in the admin
          menu between Dashboard and Notes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Who can use the AI Helper */}
        <div className="flex items-center justify-between gap-4 p-4 border rounded-lg bg-muted/50">
          <div className="space-y-0.5">
            <Label htmlFor="aiAccess" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Who can use the AI Helper
            </Label>
            <p className="text-xs text-muted-foreground">
              {aiHelperAccess === 'admins'
                ? 'Every admin in nostr.json can chat via the server proxy — the key stays on the server.'
                : 'Only you can use the AI Helper.'}
              {!proxyEnabled && aiHelperAccess === 'admins' && (
                <span className="block text-amber-600 dark:text-amber-400 font-medium mt-1">
                  Shared access needs a server-side AI_API_KEY env var (e.g. on Vercel) — none detected on this deployment.
                </span>
              )}
            </p>
          </div>
          <Select
            value={aiHelperAccess}
            onValueChange={(v) => handleAccessChange(v as AiHelperAccess)}
            disabled={isSavingAccess}
          >
            <SelectTrigger id="aiAccess" className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="master">Master user only</SelectItem>
              <SelectItem value="admins">All admins</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="aiBaseUrl">Base URL (OpenAI-compatible)</Label>
          <Input
            id="aiBaseUrl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_AI_BASE_URL}
            disabled={eventLoading}
          />
          <p className="text-xs text-muted-foreground mt-1">
            For example <code>{DEFAULT_AI_BASE_URL}</code> or any other <code>/v1</code>-style endpoint.
          </p>
        </div>

        <div>
          <Label htmlFor="aiApiKey">API Key</Label>
          <Input
            id="aiApiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            disabled={eventLoading}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Stored encrypted on the relay — never saved in plain text.
          </p>
        </div>

        <div>
          <Label htmlFor="aiModel">Model</Label>
          <div className="flex gap-2">
            {models.length > 0 ? (
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="aiModel" className="flex-1">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="aiModel"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={DEFAULT_AI_MODEL}
                className="flex-1"
              />
            )}
            <Button
              variant="outline"
              onClick={handleFetchModels}
              disabled={isTesting || !apiKey.trim()}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isTesting ? 'animate-spin' : ''}`} />
              {isTesting ? 'Testing...' : 'Fetch Models'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            "Fetch Models" verifies the key and loads the provider's model list.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {settingsEvent && (
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={isRemoving || saveSettings.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isRemoving ? 'Removing...' : 'Remove Key'}
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={saveSettings.isPending || isRemoving || !apiKey.trim()}
          >
            {saveSettings.isPending ? 'Saving...' : 'Save AI Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
