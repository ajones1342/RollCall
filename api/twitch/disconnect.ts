// Disconnect a campaign's broadcaster link: revoke the Twitch token and
// delete the row.

import {
  adminClient,
  cors,
  getAuthedUser,
  jsonResponse,
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

  // Look up the access token so we can revoke it before deleting.
  const { data: row } = await supabase
    .from('campaign_broadcasters')
    .select('access_token')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  // Best-effort revoke — don't block on failures, the row deletion is the
  // important part.
  if (row?.access_token) {
    await fetch('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        token: row.access_token,
      }),
    }).catch(() => {});
  }

  const { error: delErr } = await supabase
    .from('campaign_broadcasters')
    .delete()
    .eq('campaign_id', campaignId);

  if (delErr) {
    return jsonResponse({ error: `Failed to delete: ${delErr.message}` }, 500);
  }

  return jsonResponse({ ok: true }, 200);
}
