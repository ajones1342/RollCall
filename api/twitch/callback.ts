// Step 2 of the broadcaster link flow.
// Twitch redirects here with ?code=...&state=... after the broadcaster
// authorizes. We verify the state HMAC, exchange the code for tokens,
// fetch the broadcaster identity, store everything in
// campaign_broadcasters, and redirect back to the GM page.

import {
  adminClient,
  cors,
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  verifyState,
} from '../_lib/twitch';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return text('Method not allowed', 405);

  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    return text('Server misconfigured: TWITCH env vars missing', 500);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const origin = url.origin;

  if (errorParam) {
    return redirectToFailure(origin, errorParam);
  }
  if (!code || !state) {
    return text('Missing code or state', 400);
  }

  const campaignId = await verifyState(state);
  if (!campaignId) {
    return text('Invalid state — link request did not originate from this app', 401);
  }

  const redirectUri = `${origin}/api/twitch/callback`;

  // Exchange code for tokens.
  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return text(`Token exchange failed: ${detail}`, 502);
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string[] | string;
    token_type: string;
  };

  // Fetch the broadcaster identity.
  const userRes = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Client-Id': TWITCH_CLIENT_ID,
    },
  });
  if (!userRes.ok) {
    const detail = await userRes.text();
    return text(`Twitch user lookup failed: ${detail}`, 502);
  }
  const userPayload = (await userRes.json()) as {
    data: { id: string; login: string; display_name: string }[];
  };
  const me = userPayload.data?.[0];
  if (!me) return text('Twitch user lookup returned no user', 502);

  // Upsert the broadcaster row.
  let supabase;
  try {
    supabase = adminClient();
  } catch (e) {
    return text((e as Error).message, 500);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const scopes = Array.isArray(tokens.scope)
    ? tokens.scope
    : tokens.scope.split(' ').filter(Boolean);

  const { error: upsertErr } = await supabase
    .from('campaign_broadcasters')
    .upsert(
      {
        campaign_id: campaignId,
        broadcaster_id: me.id,
        broadcaster_login: me.login,
        broadcaster_display_name: me.display_name,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes,
      },
      { onConflict: 'campaign_id' }
    );

  if (upsertErr) {
    return text(`Failed to store broadcaster link: ${upsertErr.message}`, 500);
  }

  // Send the GM back to their campaign page with a success flag.
  const back = `${origin}/gm/${campaignId}?broadcaster=linked`;
  return Response.redirect(back, 302);
}

function text(body: string, status: number): Response {
  return cors(new Response(body, { status, headers: { 'content-type': 'text/plain' } }));
}

function redirectToFailure(origin: string, errorParam: string): Response {
  // We don't have campaignId on the error path (state may not have been
  // verified) so send the GM back to the campaigns list with the error.
  const back = `${origin}/gm?broadcaster_error=${encodeURIComponent(errorParam)}`;
  return Response.redirect(back, 302);
}
