import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAdminAuth } from '@/hooks/useRemoteNostrJson';
import { useAiAccess, useAiSettings, useAiSettingsEvent } from '@/hooks/useAiSettings';
import { useAiChat, type ChatMessage, type Model } from '@/hooks/useAiChat';
import { Bot, RefreshCw, Send, ShieldAlert, User } from 'lucide-react';

interface MessageDisplay {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function AdminAiChat() {
  const { user } = useCurrentUser();
  const { isMaster: isMasterUser, isLoading: authLoading } = useAdminAuth(user?.pubkey);
  const { canUse, isLoading: accessLoading } = useAiAccess();
  const { data: settingsEvent, isLoading: eventLoading } = useAiSettingsEvent();
  const { data: settings, isLoading: settingsLoading } = useAiSettings();
  const { sendStreamingMessage, getAvailableModels, isLoading, error, isConfigured, defaultModel } = useAiChat();

  const [messages, setMessages] = useState<MessageDisplay[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [streamingMessage, setStreamingMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Default to the configured model once settings/status resolve.
  useEffect(() => {
    if (defaultModel && !model) {
      setModel(defaultModel);
    }
  }, [defaultModel, model]);

  // Load the provider's model list once a usable credential exists
  // (personal key or server proxy).
  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    getAvailableModels()
      .then((response) => {
        if (!cancelled) setModels(response.data);
      })
      .catch(() => {
        // error state is surfaced via the hook's `error`
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured]);

  // Keep the message list scrolled to the bottom while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingMessage]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || !model || isLoading) return;

    const history: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content });

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content }]);
    setInput('');
    setStreamingMessage('');

    // Accumulate into a local variable so nothing is lost when streaming ends.
    let streamed = '';
    try {
      await sendStreamingMessage(history, (chunk) => {
        streamed += chunk;
        setStreamingMessage(streamed);
      }, model);
    } catch {
      // error state is surfaced via the hook's `error`
    } finally {
      setStreamingMessage('');
      if (streamed.trim()) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: streamed }]);
      }
    }
  };

  if (authLoading || accessLoading || eventLoading || (settingsEvent && settingsLoading)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading AI settings...</p>
      </div>
    );
  }

  if (!canUse) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-bold">AI Helper Not Available</h2>
        <p className="text-muted-foreground text-center max-w-md">
          {isMasterUser
            ? 'Save an API key in Admin Settings → AI Assistant, or configure a server-side AI_API_KEY.'
            : 'The AI Helper is not enabled for your account. The master user can share it with all admins from Admin Settings → AI Assistant.'}
        </p>
      </div>
    );
  }

  // Master saved a key but it can't be decrypted and no proxy is available.
  if (isMasterUser && settingsEvent && !settings && !isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <ShieldAlert className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-bold">Could not decrypt AI settings</h2>
        <p className="text-muted-foreground text-center max-w-md">
          The saved API key could not be decrypted. Make sure you are logged in
          as the Master User with a signer that supports NIP-44 or NIP-04.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6" />
            AI Helper
          </h2>
          <p className="text-muted-foreground">
            Chat with your configured model.
          </p>
        </div>
        <div className="w-64">
          <Select value={model} onValueChange={setModel} disabled={isLoading}>
            <SelectTrigger>
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {(models.length > 0 ? models : [{ id: model, object: 'model' } as Model]).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Conversation
            {model && <Badge variant="outline">{model}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            ref={scrollRef}
            className="h-[50vh] min-h-72 overflow-y-auto rounded-md border bg-muted/30 p-4 space-y-3"
          >
            {messages.length === 0 && !streamingMessage && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Ask anything — e.g. "Write a welcome note for our community site."
              </p>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && <Bot className="h-5 w-5 mt-1 shrink-0 text-muted-foreground" />}
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border'
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === 'user' && <User className="h-5 w-5 mt-1 shrink-0 text-muted-foreground" />}
              </div>
            ))}

            {streamingMessage && (
              <div className="flex gap-2 justify-start">
                <Bot className="h-5 w-5 mt-1 shrink-0 text-muted-foreground" />
                <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words bg-card border">
                  {streamingMessage}
                  <span className="inline-block w-2 h-4 ml-1 bg-muted-foreground/50 animate-pulse" />
                </div>
              </div>
            )}

            {isLoading && !streamingMessage && (
              <div className="flex gap-2 items-center text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Thinking...
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={model ? 'Type your message... (Enter to send, Shift+Enter for newline)' : 'Select a model first...'}
              disabled={isLoading || !model}
              rows={2}
              className="resize-none"
            />
            <Button onClick={handleSend} disabled={isLoading || !input.trim() || !model} className="self-end">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
