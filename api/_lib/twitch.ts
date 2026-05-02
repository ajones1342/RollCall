// Shared helpers for the Twitch broadcaster link flow.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
export const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// Scopes we request from the broadcaster. user:write:chat lets us POST chat
// messages on the broadcaster's behalf. Add channel:read:subscriptions later
// if we ever ship sub badges.
export const BROADCASTER_SCOPES = ['user:write:chat'];

export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Server misconfigured: SUPABASE env vars missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function jsonResponse(body: unknown, status: number): Response {
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  return cors(res);
}

export function cors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}

// Random hex string (Edge runtime — Web Crypto only).
export function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// HMAC-SHA256, hex-encoded. Used to sign / verify the OAuth state param so
// only flows we initiated reach the callback.
export async function hmacHex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Build the OAuth state string: campaignId.nonce.signature.
export async function signState(campaignId: string): Promise<string> {
  if (!TWITCH_CLIENT_SECRET) throw new Error('TWITCH_CLIENT_SECRET missing');
  const nonce = randomHex(12);
  const payload = `${campaignId}.${nonce}`;
  const sig = await hmacHex(TWITCH_CLIENT_SECRET, payload);
  return `${payload}.${sig}`;
}

// Verify a state string and return its campaignId. Returns null on bad state.
export async function verifyState(state: string): Promise<string | null> {
  if (!TWITCH_CLIENT_SECRET) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [campaignId, nonce, sig] = parts;
  if (!campaignId || !nonce || !sig) return null;
  const expected = await hmacHex(TWITCH_CLIENT_SECRET, `${campaignId}.${nonce}`);
  // Constant-time-ish comparison
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? campaignId : null;
}

// Validate a Supabase JWT and return the user. Returns null if invalid.
export async function getAuthedUser(
  supabase: SupabaseClient,
  authHeader: string | null
): Promise<{ id: string; email?: string } | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}

// Confirm the given user owns the given campaign.
export async function userOwnsCampaign(
  supabase: SupabaseClient,
  userId: string,
  campaignId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('campaigns')
    .select('owner_id')
    .eq('id', campaignId)
    .maybeSingle();
  return data?.owner_id === userId;
}
