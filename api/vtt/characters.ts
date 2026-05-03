// Returns the campaign's character list for VTT modules to build a
// name-to-UUID mapping dialog. Auth: Bearer token in Authorization header
// (same per-campaign token as /api/vtt/state).
//
// Use case: a Fantasy Grounds Lua extension (or Foundry module, etc.)
// fetches this once on connect, presents each FG combatant with a
// dropdown of RollCall characters so the GM can pick the matching player.

import {
  adminClient,
  cors,
  getCampaignFromVttToken,
} from '../_lib/twitch';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'GET') return cors(json({ error: 'Method not allowed' }, 405));

  let supabase;
  try {
    supabase = adminClient();
  } catch (e) {
    return cors(json({ error: (e as Error).message }, 500));
  }

  const campaignId = await getCampaignFromVttToken(
    supabase,
    req.headers.get('authorization')
  );
  if (!campaignId) {
    return cors(json({ error: 'Missing or invalid Bearer token' }, 401));
  }

  const { data, error } = await supabase
    .from('characters')
    .select('id, name, race, class, twitch_display_name, display_order')
    .eq('campaign_id', campaignId)
    .order('display_order', { ascending: true });

  if (error) {
    return cors(json({ error: 'Read failed', detail: error.message }, 500));
  }

  return cors(json({ characters: data ?? [] }, 200));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
