import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { NostrEvent } from '@nostrify/nostrify';

type NostrSigner = {
  getPublicKey: () => Promise<string>;
  signEvent: (event: Omit<NostrEvent, 'id' | 'sig'>) => Promise<NostrEvent>;
};

/**
 * NIP-98 authenticated fetch — signs a kind 27235 HTTP-auth event with the
 * user's extension/bunker signer and sends it as `Authorization: Nostr <b64>`.
 *
 * Replaces swarm's session-cookie admin flow (which mints sessions from a bare
 * pubkey with no proof of key possession). Each request is individually signed;
 * no cookies, no session state.
 *
 * The `u` tag must be the absolute request URL — resolves relative URLs
 * against the current origin.
 */
export async function nip98Fetch(
  urlStr: string,
  init: RequestInit = {},
  user: { pubkey: string; signer: NostrSigner },
): Promise<Response> {
  const url = new URL(urlStr, window.location.origin).href;
  const method = (init.method || 'GET').toUpperCase();

  const pubkey = user.pubkey;

  const body = typeof init.body === 'string' ? init.body : undefined;
  const tags: string[][] = [
    ['u', url],
    ['method', method],
  ];
  if (body !== undefined) {
    tags.push(['payload', bytesToHex(sha256(new TextEncoder().encode(body)))]);
  }

  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
    pubkey,
  };

  const signed = await user.signer.signEvent(event);
  const token = btoa(JSON.stringify(signed));

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Nostr ${token}`);
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Signed auth is bound to the 'u' tag URL — never let a redirect carry it
  // to a different URL (verifier would reject the stale 'u' anyway).
  return fetch(url, { ...init, method, headers, redirect: 'manual' });
}
