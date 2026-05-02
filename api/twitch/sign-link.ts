// Step 1 of the broadcaster link flow.
// GM (signed in via Supabase) calls this with their campaign ID. We verify
// they own it, sign an OAuth state token, and return the Twitch authorize
// URL the browser should navigate to. The user can then sign in on Twitch
// as their broadcast channel (which may be a different account than the GM
// account they're signed in with here).

import {
  adminClient,
  BROADCASTER_SCOPES,
  cors,
  getAuthedUser,
  jsonResponse,
  signState,
  TWITCH_CLIENT_ID,
  userOwnsCampaign,
} from '../_lib/twitch';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  if (!TWITCH_CLIENT_ID) {
    return jsonResponse({ error: 'TWITCH_CLIENT_ID env var missing' }, 500);
  }

  let body: { campaignId?: string };
  try {
    body = (await req.json()) as { campaignId?: string };
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const campaignId = body.campaignId;
  if (!campaignId) return jsonResponse({ error: 'Missing campaignId' }, 400);

  let supabase;
  try {
    supabase = adminClient();
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }

  const user = await getAuthedUser(supabase, req.headers.get('authorization'));
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const ok = await userOwnsCampaign(supabase, user.id, campaignId);
  if (!ok) return jsonResponse({ error: 'Not the campaign owner' }, 403);

  const state = await signState(campaignId);

  // Resolve callback URL from the request origin so it works in dev + prod
  // without hardcoding. The same origin must be registered on the Twitch app.
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/twitch/callback`;

  const authorizeUrl =
    `https://id.twitch.tv/oauth2/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: TWITCH_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: BROADCASTER_SCOPES.join(' '),
      state,
      // Force the consent screen so the user can pick a different Twitch
      // account than they're currently logged into in the browser.
      force_verify: 'true',
    });

  return jsonResponse({ authorizeUrl }, 200);
}
