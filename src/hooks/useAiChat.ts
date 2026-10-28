import { useCallback, useState } from 'react';
import { useAiSettings, useAiProxyStatus, DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from './useAiSettings';
import { useCurrentUser } from './useCurrentUser';
import { nip98Fetch } from '@/lib/nip98';

// Types for OpenAI-compatible chat APIs (compatible with OpenAI ChatCompletionMessageParam)
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface Model {
  id: string;
  name?: string;
  description?: string;
  object: string;
  owned_by?: string;
  created?: number;
  context_window?: number;
  context_length?: number;
  pricing?: {
    prompt: string;
    completion: string;
  };
}

export interface ModelsResponse {
  object: string;
  data: Model[];
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

// Helper function to handle API errors with user-friendly messages
async function handleAPIError(response: Response) {
  if (response.ok) return;

  let detail = '';
  try {
    const error = await response.json();
    detail = error.error?.message || error.message || error.details || '';
  } catch {
    // no JSON body — fall through to status-based messages
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Authentication failed.${detail ? ` ${detail}` : ' Check that the API key saved in Admin Settings is correct.'}`);
  } else if (response.status === 404) {
    throw new Error('Endpoint not found. Check the API base URL in Admin Settings.');
  } else if (response.status === 429) {
    throw new Error('Rate limited. Please wait a moment and try again.');
  } else if (response.status >= 500) {
    throw new Error('The AI provider returned a server error. Please try again in a few moments.');
  }
  throw new Error(detail || `API error (${response.status}): ${response.statusText}`);
}

function toErrorMessage(err: unknown): string {
  let errorMessage = 'An unexpected error occurred';

  if (err instanceof Error) {
    errorMessage = err.message;
  } else if (typeof err === 'string') {
    errorMessage = err;
  }

  if (errorMessage.includes('Failed to fetch') || errorMessage.includes('Network')) {
    errorMessage = 'Network error: could not reach the AI provider. Check the base URL and your connection.';
  }

  return errorMessage;
}

/**
 * Fetch the model list from an OpenAI-compatible provider. Exported
 * standalone so the settings page can test unsaved credentials.
 */
export async function fetchAiModels(baseUrl: string, apiKey: string): Promise<ModelsResponse> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  await handleAPIError(response);
  return response.json();
}

/**
 * AI chat completions against any OpenAI-compatible provider.
 *
 * Two auth paths:
 *  - Personal key: the master user's encrypted settings (see useAiSettings) —
 *     calls go straight to the provider with `Authorization: Bearer`.
 *  - Server proxy: `/api/ai/*` serverless functions — the key stays on the
 *     server and calls are NIP-98 signed. This is how non-master admins get
 *     access when `ai_helper_access` = 'admins'.
 */
export function useAiChat() {
  const { user } = useCurrentUser();
  const { data: settings } = useAiSettings();
  const { data: proxyStatus } = useAiProxyStatus();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = normalizeBaseUrl(settings?.baseUrl || DEFAULT_AI_BASE_URL);
  const apiKey = settings?.apiKey;
  const proxyEnabled = !!proxyStatus?.enabled;
  const defaultModel = settings?.model || proxyStatus?.defaultModel || DEFAULT_AI_MODEL;

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Fetch against the provider directly (personal key) or through the
   * server proxy (NIP-98). `path` is the provider-relative path — the proxy
   * mirrors it under /api/ai, except /chat/completions which maps to the
   * single-segment /api/ai/completions (the catch-all only matches one
   * path segment on Vercel).
   */
  const aiFetch = useCallback(async (path: string, init: RequestInit): Promise<Response> => {
    if (apiKey) {
      return fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(120_000),
      });
    }
    if (!user?.signer) {
      throw new Error('You must be logged in to use the AI Helper.');
    }
    const proxyPath = path === '/chat/completions' ? '/completions' : path;
    return nip98Fetch(`/api/ai${proxyPath}`, init, user);
  }, [apiKey, baseUrl, user]);

  const requireConfigured = useCallback(() => {
    if (!apiKey && !proxyEnabled) {
      throw new Error('AI assistant is not configured. Add an API key in Admin Settings.');
    }
  }, [apiKey, proxyEnabled]);

  // Chat completion function
  const sendChatMessage = useCallback(async (
    messages: ChatMessage[],
    model: string = defaultModel,
    options?: Partial<ChatCompletionRequest>,
  ): Promise<ChatCompletionResponse> => {
    requireConfigured();
    setIsLoading(true);
    setError(null);

    try {
      const requestBody: ChatCompletionRequest = {
        model,
        messages,
        ...options,
      };

      const response = await aiFetch('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      await handleAPIError(response);
      return await response.json();
    } catch (err) {
      const errorMessage = toErrorMessage(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [defaultModel, aiFetch, requireConfigured]);

  // Streaming chat completion function
  const sendStreamingMessage = useCallback(async (
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    model: string = defaultModel,
    options?: Partial<ChatCompletionRequest>,
  ): Promise<void> => {
    requireConfigured();
    setIsLoading(true);
    setError(null);

    try {
      const requestBody: ChatCompletionRequest = {
        model,
        messages,
        stream: true,
        ...options,
      };

      const response = await aiFetch('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      await handleAPIError(response);

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') return;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  onChunk(content);
                }
              } catch {
                // Ignore parsing errors for incomplete chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      const errorMessage = toErrorMessage(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [defaultModel, aiFetch, requireConfigured]);

  // Get available models
  const getAvailableModels = useCallback(async (): Promise<ModelsResponse> => {
    requireConfigured();
    setIsLoading(true);
    setError(null);

    try {
      if (apiKey) {
        return await fetchAiModels(baseUrl, apiKey);
      }
      const response = await aiFetch('/models', {});
      await handleAPIError(response);
      return await response.json();
    } catch (err) {
      const errorMessage = toErrorMessage(err);
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [apiKey, baseUrl, aiFetch, requireConfigured]);

  return {
    // State
    isLoading,
    error,
    isConfigured: !!apiKey || proxyEnabled,
    settings: settings ?? null,
    defaultModel,
    viaProxy: !apiKey && proxyEnabled,

    // Actions
    sendChatMessage,
    sendStreamingMessage,
    getAvailableModels,
    clearError,
  };
}
