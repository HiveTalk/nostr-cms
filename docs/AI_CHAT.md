### AI Integration — OpenAI-Compatible Providers

The CMS ships with an **AI Helper** in the admin panel. It talks to any
OpenAI-compatible chat API (for example
`https://gateway.trytokenfactory.dev/v1`) using a standard `Bearer` API key —
no Nostr-specific provider required.

There are two hooks:

- `useAiSettings` — stores the provider config (`apiKey`, `baseUrl`, `model`)
  **encrypted on the relay** as a replaceable kind `30078` event. The content
  is NIP-44 (or NIP-04 fallback) encrypted to the master user's own pubkey,
  so only they can ever read the key — not even the relay operator.
- `useAiChat` — chat completions, streaming completions, and model discovery
  against the configured provider.

```tsx
import { useAiChat, type ChatMessage, type Model } from '@/hooks/useAiChat';
import { useAiSettings } from '@/hooks/useAiSettings';

const {
  sendChatMessage,
  sendStreamingMessage,
  getAvailableModels,
  isLoading,
  error,
  isConfigured,
  settings,
} = useAiChat();
```

#### The `AI_API_KEY` environment variable

`AI_API_KEY` is the conventional env var name for the provider key on this
project. It has two uses:

1. **Server-side proxy (Vercel).** The `api/ai/*` serverless functions read
   `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` from the function environment —
   never `VITE_*`, so the key is never bundled into the frontend. See
   "Shared access via the server proxy" below.
2. **Local tooling and scripts** — for example, checking which models a
   provider offers before pasting the key into the admin panel:

   ```bash
   export AI_API_KEY="sk-..."
   curl https://gateway.trytokenfactory.dev/v1/models \
     -H "Authorization: Bearer $AI_API_KEY"
   ```

   The same variable works for local AI CLI tools (Codex `model_providers`
   `env_key`, OpenCode `apiKey: "{env:AI_API_KEY}"`, or
   `ANTHROPIC_AUTH_TOKEN=$AI_API_KEY` for Claude Code against an
   Anthropic-compatible gateway).

#### Shared access via the server proxy

The repo ships a Vercel serverless proxy at `api/ai/[...path].ts`:

| Route | Purpose |
|-------|---------|
| `GET /api/ai/status` | `{ enabled, defaultModel }` — public probe |
| `GET /api/ai/models` | Proxied model list (authenticated) |
| `POST /api/ai/chat/completions` | Proxied chat completion, streamed (authenticated) |

Callers authenticate with **NIP-98** (`Authorization: Nostr <base64 kind
27235>` — the same scheme the Swarm admin API uses). The function verifies
the signature, timestamp, `u`/`method`/`payload` tags, then authorizes:

- the **master pubkey** (nostr.json `_` entry or `VITE_MASTER_PUBKEY`) — always, or
- **any admin in nostr.json** — only when the site-config tag
  `ai_helper_access` = `admins` (fetched from the kind 30078 config event on
  `VITE_DEFAULT_RELAY`, cached per warm instance).

The master toggles this in **Admin Settings → AI Assistant → "Who can use
the AI Helper"**. With `AI_API_KEY` set on Vercel:

- Master uses the proxy (or their own encrypted key — that takes precedence).
- Other admins get the AI Helper too — calls are NIP-98 signed from their
  signer, so they never see the key.

**Server env vars (no `VITE_` prefix):** `AI_API_KEY` (required),
`AI_BASE_URL`, `AI_MODEL`. The function also reads the *same*
`VITE_REMOTE_NOSTR_JSON_URL`, `VITE_DEFAULT_RELAY`, `VITE_MASTER_PUBKEY`
values the frontend uses — Vercel exposes all env vars to functions.

**Notes:**

- `vercel.json` rewrites `/api/*` to the Swarm API. `vercel.json` rewrites
  are evaluated **before** filesystem functions, so the rewrite source
  excludes `ai` paths (`/api/:path((?!ai(?:/|$)).+)`) — `/api/ai/*` falls
  through to these functions while `/api/admin/*` etc. still reach Swarm.
- Plain `vite dev` has no `/api/ai/*` — `useAiProxyStatus` reports
  `enabled: false` and the master user's encrypted key remains the working
  path. Use `vercel dev` to exercise the proxy locally.
- The encrypted personal-key flow (below) is unchanged and still works on
  static hosting without any server component.

#### Setup flow (admin UI)

1. Log in as the **master user**.
2. Go to **Admin Settings → AI Assistant** (`/admin/system-settings`).
3. Enter the provider's base URL and API key, click **Fetch Models** to verify
   the connection and load the model list, pick a model, and **Save AI
   Settings**.
4. The **AI Helper** item appears in the sidebar between **Dashboard** and
   **Notes** (`/admin/ai`).

If no API key is saved, the AI Helper stays hidden from the navigation.
**Remove Key** publishes a NIP-09 deletion for the settings event and hides
the helper again.

#### Model Selector Component

```tsx
function ModelSelector({ onModelSelect }: { onModelSelect: (modelId: string) => void }) {
  const { getAvailableModels, isLoading, isConfigured } = useAiChat();
  const { data: settings } = useAiSettings();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  useEffect(() => {
    if (!isConfigured) return;

    const fetchModels = async () => {
      try {
        const response = await getAvailableModels();
        setModels(response.data);

        // Prefer the saved default model, otherwise fall back to the first.
        const saved = settings?.model;
        const initial = response.data.some((m) => m.id === saved)
          ? saved!
          : response.data[0]?.id;
        if (initial) {
          setSelectedModel(initial);
          onModelSelect(initial);
        }
      } catch (err) {
        console.error('Failed to fetch models:', err);
      }
    };

    fetchModels();
  }, [getAvailableModels, isConfigured, settings, onModelSelect]);

  return (
    <div>
      <label htmlFor="model-select">Choose Model:</label>
      <select
        id="model-select"
        value={selectedModel}
        onChange={(e) => {
          setSelectedModel(e.target.value);
          onModelSelect(e.target.value);
        }}
        disabled={isLoading}
      >
        <option value="">Select a model...</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
          </option>
        ))}
      </select>
    </div>
  );
}
```

#### Basic Chat Example

```tsx
function AIChat() {
  const { sendChatMessage, isLoading, error, isConfigured } = useAiChat();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('');

  const handleSend = async () => {
    if (!input.trim() || !selectedModel) return;

    const newMessages = [...messages, { role: 'user' as const, content: input }];
    setMessages(newMessages);
    setInput('');

    try {
      const response = await sendChatMessage(newMessages, selectedModel);
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: response.choices[0].message.content as string,
      }]);
    } catch (err) {
      console.error('Chat error:', err);
    }
  };

  if (!isConfigured) {
    return <div>Configure an API key in Admin Settings → AI Assistant first.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      {error && <div className="text-red-500 mb-4">{error}</div>}

      {/* Model Selection */}
      <div className="mb-4">
        <ModelSelector onModelSelect={setSelectedModel} />
      </div>

      <div className="space-y-2 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`p-2 rounded ${msg.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>
            <strong>{msg.role}:</strong> {msg.content as string}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          className="flex-1 p-2 border rounded"
          disabled={isLoading || !selectedModel}
          placeholder={!selectedModel ? 'Select a model first...' : 'Type your message...'}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !selectedModel}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

#### Streaming Chat Example

```tsx
function StreamingChat() {
  const { sendStreamingMessage } = useAiChat();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentResponse, setCurrentResponse] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('');

  const handleStreaming = async (content: string) => {
    if (!selectedModel) return;

    setCurrentResponse('');
    const newMessages = [...messages, { role: 'user' as const, content }];
    setMessages(newMessages);

    // Accumulate into a local variable so nothing is lost on completion.
    let streamed = '';
    try {
      await sendStreamingMessage(newMessages, (chunk) => {
        streamed += chunk;
        setCurrentResponse(streamed);
      }, selectedModel);

      if (streamed.trim()) {
        setMessages((prev) => [...prev, { role: 'assistant', content: streamed }]);
      }
    } catch (err) {
      console.error('Streaming error:', err);
    } finally {
      setCurrentResponse('');
    }
  };

  return (
    <div>
      {/* Model selection UI */}
      <div className="mb-4">
        <ModelSelector onModelSelect={setSelectedModel} />
      </div>

      {/* Chat interface */}
      {/* ... rest of your chat UI */}
    </div>
  );
}
```

#### Model Information

Models are fetched dynamically from `GET {baseUrl}/models` and typically
include:

- **id**: the model identifier to pass to chat calls
- **object**: `"model"`
- **owned_by**: the serving provider
- **context_window / context_length**: maximum token limit (when provided)
- **pricing**: per-token pricing (when the provider reports it)

#### Key Points

- **Configuration**: The master user saves `{ apiKey, baseUrl, model }` in
  Admin Settings → AI Assistant. Everything else reads from there.
- **Encrypted storage**: The key lives in a NIP-44/NIP-04 encrypted kind
  30078 event (`d` tag `nostr-cms-ai-settings:<relay>`) — only the master
  user can decrypt it, and it roams across their devices automatically.
- **Any OpenAI-compatible provider**: The chat calls are plain
  `POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>`.
- **Visibility**: The AI Helper menu item appears when `useAiAccess()` says
  `canUse` — master with a key or the proxy, or any admin when
  `ai_helper_access` = 'admins' and the proxy is enabled. Use
  `useAiSettingsEvent()` for the cheap encrypted-key existence check (no
  decryption) and `useAiSettings()` for the decrypted values.
- **Error Handling**: Handle `isLoading` and `error` states appropriately.

## Implementation Patterns and Best Practices

### Dialog Component Patterns

When using Dialog components, always ensure accessibility compliance by including required elements:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// ✅ Correct - Always include DialogHeader with DialogTitle
<Dialog open={isOpen} onOpenChange={onClose}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>
        Optional description for screen readers
      </DialogDescription>
    </DialogHeader>
    {/* Dialog content */}
  </DialogContent>
</Dialog>
```

**Important**: Even if you want to hide the title visually, use the `VisuallyHidden` component to maintain accessibility:

```tsx
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

<DialogHeader>
  <VisuallyHidden>
    <DialogTitle>Hidden Title for Screen Readers</DialogTitle>
  </VisuallyHidden>
</DialogHeader>
```

### Streaming Response Handling

When implementing streaming chat interfaces, always accumulate streamed content in a local variable before clearing the streaming state to prevent content loss:

```tsx
const handleStreamingResponse = async () => {
  let streamedContent = ''; // ✅ Use local variable to accumulate content

  try {
    await sendStreamingMessage(messages, (chunk) => {
      streamedContent += chunk; // ✅ Accumulate in local variable
      setCurrentStreamingMessage(streamedContent); // Update UI
    }, model);

    // ✅ Save accumulated content to persistent state
    if (streamedContent.trim()) {
      const assistantMessage: MessageDisplay = {
        id: Date.now().toString(),
        role: 'assistant',
        content: streamedContent, // ✅ Use accumulated content
        timestamp: new Date()
      };
      setMessages(prev => [...prev, assistantMessage]);
    }
  } finally {
    setCurrentStreamingMessage(''); // ✅ Clear streaming state after saving
  }
};
```

### Error Boundary Patterns

Always wrap AI components with error boundaries and provide user-friendly error messages for common failure scenarios:

```tsx
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Alert, AlertDescription } from '@/components/ui/alert';

function AIChatWithErrorBoundary() {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Something went wrong with the AI chat. Please refresh the page and try again.
            </AlertDescription>
          </Alert>
        </div>
      }
    >
      <AIChat />
    </ErrorBoundary>
  );
}

// In your AI component, handle specific error types gracefully:
function useAIWithErrorHandling() {
  const { sendChatMessage, error, clearError } = useAiChat();

  const sendMessage = async (messages: ChatMessage[], modelId: string) => {
    try {
      await sendChatMessage(messages, modelId);
    } catch (err) {
      // Handle specific error types with user-friendly messages
      if (err instanceof Error) {
        if (err.message.includes('401') || err.message.includes('Authentication')) {
          throw new Error('Authentication failed. Check the API key in Admin Settings.');
        } else if (err.message.includes('Rate limited')) {
          throw new Error('Too many requests. Please wait and try again.');
        } else if (err.message.includes('Network')) {
          throw new Error('Network error. Please check your internet connection.');
        }
      }
      throw err; // Re-throw for error boundary
    }
  };

  return { sendMessage, error, clearError };
}
```
