import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { SimplePool, verifyEvent, type NostrEvent } from 'nostr-tools';
import WS from 'ws';

// Polyfill WebSocket for Node runtimes that lack a global (Node < 22).
if (typeof (globalThis as Record<string, unknown>).WebSocket === 'undefined') {
  (globalThis as Record<string, unknown>).WebSocket = WS;
}

/**
 * Server-side AI proxy (Vercel serverless function).
 *
 * Routes (catch-all /api/ai/*):
 *   GET  /api/ai/status            -> { enabled, defaultModel }  (public)
 *   GET  /api/ai/models            -> provider's model list      (auth)
 *   POST /api/ai/chat/completions  -> chat completion, streamed  (auth)
 *
 * The provider key lives ONLY in the server-side AI_API_KEY env var — it is
 * never bundled into the frontend. Callers authenticate with NIP-98
 * (`Authorization: Nostr <base64 kind-27235 event>`), which proves control of
 * a Nostr key. Authorization then checks:
 *   - caller is the master pubkey, or
 *   - site config `ai_helper_access` = 'admins' AND caller is in nostr.json.
 *
 * Server env vars (no VITE_ prefix needed — they never reach the client):
 *   AI_API_KEY                    OpenAI-compatible provider key (required)
 *   AI_BASE_URL                   provider base URL (optional, see default below)
 *   AI_MODEL                      default model advertised by /api/ai/status
 *   VITE_REMOTE_NOSTR_JSON_URL    admin directory (same value the client uses)
 *   VITE_DEFAULT_RELAY            relay holding the site-config event
 *   VITE_MASTER_PUBKEY            fallback master pubkey
 */

const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://gateway.trytokenfactory.dev/v1').replace(/\/+$/, '');
const AI_MODEL = process.env.AI_MODEL || 'glm-5.3-flash';
const NOSTR_JSON_URL = process.env.VITE_REMOTE_NOSTR_JSON_URL || process.env.NOSTR_JSON_URL || '';
const DEFAULT_RELAY = process.env.VITE_DEFAULT_RELAY || '';
const MASTER_PUBKEY = (process.env.VITE_MASTER_PUBKEY || '').toLowerCase().trim();

const NIP98_MAX_AGE_SEC = 120;

// --- Minimal Vercel request/response types (avoids a @vercel/node dep) ---
type VercelRequest = IncomingMessage & {
  query: Record<string, string | string[]>;
  body?: unknown;
};
type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

// --- Small caches (warm-instance reuse across invocations) ---
interface AdminDirectory { admins: Set<string>; master: string }
let directoryCache: { at: number; data: AdminDirectory } | null = null;
let accessCache: { at: number; value: 'master' | 'admins' } | null = null;

async function getAdminDirectory(): Promise<AdminDirectory> {
  if (directoryCache && Date.now() - directoryCache.at < 5 * 60_000) {
    return directoryCache.data;
  }
  if (!NOSTR_JSON_URL) return { admins: new Set(), master: MASTER_PUBKEY };

  const res = await fetch(NOSTR_JSON_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`nostr.json fetch failed: ${res.status}`);
  const json = await res.json();
  const names = (json?.names ?? {}) as Record<string, string>;
  const admins = new Set(Object.values(names).map((pk) => String(pk).toLowerCase().trim()));
  const master = (names._ || MASTER_PUBKEY).toLowerCase().trim();
  if (master) admins.add(master);

  const data: AdminDirectory = { admins, master };
  directoryCache = { at: Date.now(), data };
  return data;
}

/**
 * Read `ai_helper_access` from the replaceable kind 30078 site-config event on
 * the relay (same tag set buildSiteConfigTags() writes). Defaults to 'master'
 * when the event, tag, or relay is unavailable — the most restrictive mode.
 */
async function getAiHelperAccess(master: string): Promise<'master' | 'admins'> {
  if (accessCache && Date.now() - accessCache.at < 60_000) return accessCache.value;
  if (!DEFAULT_RELAY || !master) return 'master';

  try {
    const pool = new SimplePool();
    try {
      const filter = {
        kinds: [30078],
        authors: [master],
        '#d': [`nostr-meetup-site-config:${DEFAULT_RELAY}`, 'nostr-meetup-site-config'],
        limit: 2,
      };
      const events = await Promise.race([
        pool.querySync([DEFAULT_RELAY], filter),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      // Prefer the scoped d-tag event when both exist.
      const scoped = `nostr-meetup-site-config:${DEFAULT_RELAY}`;
      const event = events.find((e) => e.tags.some(([n, v]) => n === 'd' && v === scoped)) ?? events[0];
      const tag = event?.tags.find(([n]) => n === 'ai_helper_access')?.[1];
      const value = tag === 'admins' ? 'admins' : 'master';
      accessCache = { at: Date.now(), value };
      return value;
    } finally {
      pool.close([DEFAULT_RELAY]);
    }
  } catch {
    return 'master';
  }
}

/**
 * NIP-98 verify: kind 27235, valid sig, fresh timestamp, matching
 * u/method/payload tags. Returns the caller pubkey, or a short reason string
 * ('nip98:*') describing which check failed — surfaced in the 401 body for
 * debugging and admin UX, safe to expose (no secrets).
 */
function verifyNip98(req: VercelRequest, rawBody: Buffer): { pubkey: string } | { reason: string } {
  const auth = req.headers['authorization'];
  if (typeof auth !== 'string' || !auth.startsWith('Nostr ')) {
    return { reason: 'missing_auth_header' };
  }

  let event: NostrEvent;
  try {
    event = JSON.parse(Buffer.from(auth.slice(6), 'base64').toString('utf8'));
  } catch {
    return { reason: 'malformed_auth_event' };
  }

  if (event.kind !== 27235) return { reason: 'wrong_kind' };
  if (!verifyEvent(event)) return { reason: 'bad_signature' };
  if (Math.abs(Math.floor(Date.now() / 1000) - event.created_at) > NIP98_MAX_AGE_SEC) {
    return { reason: 'stale_timestamp' };
  }

  const tag = (name: string) => event.tags.find(([n]) => n === name)?.[1];
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  // Vercel rewrites req.url internally, appending the catch-all param as a
  // query string (e.g. "/api/ai/models?...path=models"). The client signs the
  // clean URL — accept both the full req.url and the query-stripped pathname.
  const pathname = (req.url || '').split('?')[0];
  const urlCandidates = [
    `${proto}://${req.headers.host}${pathname}`,
    `${proto}://${req.headers.host}${req.url}`,
  ];
  const uTag = tag('u') || '';
  if (!urlCandidates.includes(uTag)) {
    return { reason: `url_mismatch expected ${urlCandidates[0]}` };
  }
  if ((tag('method') || '').toUpperCase() !== (req.method || 'GET').toUpperCase()) {
    return { reason: 'method_mismatch' };
  }

  const payloadTag = tag('payload');
  if (payloadTag) {
    // Accept the raw stream body OR the platform-parsed body reserialized —
    // depends on whether the runtime pre-parses JSON bodies.
    const candidates: Buffer[] = [rawBody];
    if (typeof req.body === 'string') candidates.push(Buffer.from(req.body));
    else if (req.body && typeof req.body === 'object') candidates.push(Buffer.from(JSON.stringify(req.body)));
    const ok = candidates.some((b) => b.length > 0 && createHash('sha256').update(b).digest('hex') === payloadTag);
    if (!ok) return { reason: 'payload_mismatch' };
  }

  return { pubkey: (event.pubkey || '').toLowerCase() };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function authorize(req: VercelRequest, rawBody: Buffer): Promise<{ ok: boolean; reason?: string }> {
  const verified = verifyNip98(req, rawBody);
  if ('reason' in verified) return { ok: false, reason: `nip98:${verified.reason}` };

  const dir = await getAdminDirectory();
  if (verified.pubkey === dir.master) return { ok: true };
  if (!dir.admins.has(verified.pubkey)) return { ok: false, reason: 'not_in_admin_directory' };

  const access = await getAiHelperAccess(dir.master);
  if (access !== 'admins') return { ok: false, reason: 'access_master_only' };
  return { ok: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Derive the route from the URL path — req.query.catch-all params vary
  // across Vercel runtime versions, the pathname is reliable.
  const pathname = (req.url || '').split('?')[0];
  const route = pathname.replace(/^\/api\/ai\/?/, '').replace(/\/+$/, '');

  if (route === 'status' || route === '') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
    return res.status(200).json({ enabled: !!AI_API_KEY, defaultModel: AI_MODEL });
  }

  if (!AI_API_KEY) {
    return res.status(404).json({ error: 'AI proxy not configured on this deployment' });
  }

  // Prefer the raw stream (needed for NIP-98 payload hashing). If a platform
  // body parser already consumed it (req.body set), fall back to reserialized
  // JSON; if the stream fails entirely, treat as empty.
  let rawBody: Buffer = Buffer.alloc(0);
  if (req.method === 'POST') {
    try {
      rawBody = await readBody(req);
    } catch {
      rawBody = Buffer.alloc(0);
    }
    if (rawBody.length === 0 && req.body && typeof req.body === 'object') {
      rawBody = Buffer.from(JSON.stringify(req.body));
    }
  }

  let allowed: { ok: boolean; reason?: string };
  try {
    allowed = await authorize(req, rawBody);
  } catch {
    return res.status(503).json({ error: 'could not verify admin status' });
  }
  if (!allowed.ok) {
    return res.status(401).json({ error: 'unauthorized', details: allowed.reason });
  }

  try {
    if (route === 'models' && req.method === 'GET') {
      const upstream = await fetch(`${AI_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${AI_API_KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      res.status(upstream.status);
      res.end(await upstream.text());
      return;
    }

    // `completions` is the single-segment alias used by the client — the
    // [...path] catch-all on this deployment only matches one path segment,
    // so `chat/completions` cannot be routed; both spellings are accepted.
    if ((route === 'completions' || route === 'chat/completions') && req.method === 'POST') {
      const upstream = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: new Uint8Array(rawBody),
        signal: AbortSignal.timeout(115_000),
      });

      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      if (!upstream.body) return res.end();

      // Stream the provider response (SSE) straight through to the client.
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) res.write(Buffer.from(value));
        }
      } finally {
        res.end();
      }
      return;
    }

    return res.status(404).json({ error: 'unknown route' });
  } catch {
    return res.status(502).json({ error: 'upstream provider request failed' });
  }
}

export const config = { api: { bodyParser: false } };
