// Table-points webhook. Designed for streamer.bot or any tool that wants
// to grant / spend table points (Klout / Hero Points / etc.) from an
// external trigger — channel point redemption, chat command, etc.
//
// Auth: same Bearer campaign token as /api/vtt/state and /api/vtt/scene.
// Body shape:
//
//   { "character": "Alice", "delta": 1 }   // grant 1
//   { "character": "Alice", "delta": -1 }  // spend 1
//   { "character": "Alice", "set": 0 }     // reset to absolute value
//
// `character` is matched case-insensitively, trimmed, against
// twitch_display_name FIRST (what streamer.bot triggers usually have for
// the user who redeemed / typed a command), then character.name as a
// fallback. Ties are resolved to the first match — name your characters
// distinctly if you have collisions.
//
// Refuses 409 if the feature is not enabled on the campaign, so the
// streamer.bot user gets an obvious error instead of silently mutating an
// unused column.

import { adminClient, cors, getCampaignFromVttToken } from '../_lib/twitch';

export const config = { runtime: 'edge' };

type CharRow = {
  id: string;
  name: string | null;
  twitch_display_name: string | null;
  table_points: number;
};

type SettingsBlob = {
  tablePoints?: { enabled?: boolean };
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }
  if (req.method !== 'POST') {
    return cors(json({ error: 'Method not allowed' }, 405));
  }

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

  let body: { character?: unknown; delta?: unknown; set?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return cors(json({ error: 'Invalid JSON body' }, 400));
  }

  const target = typeof body.character === 'string' ? body.character.trim() : '';
  if (!target) {
    return cors(json({ error: '`character` (string) is required' }, 400));
  }

  const hasDelta = typeof body.delta === 'number' && Number.isFinite(body.delta);
  const hasSet = typeof body.set === 'number' && Number.isFinite(body.set);
  if (hasDelta === hasSet) {
    return cors(
      json(
        {
          error:
            'Provide exactly one of `delta` (number) or `set` (number, non-negative integer)',
        },
        400
      )
    );
  }

  // Confirm the feature is enabled before mutating; the column exists on
  // every campaign but writing to it for a campaign that hasn't opted in
  // would be a footgun for the webhook caller.
  const { data: campaign, error: readErr } = await supabase
    .from('campaigns')
    .select('settings')
    .eq('id', campaignId)
    .maybeSingle();
  if (readErr) return cors(json({ error: 'Campaign read failed' }, 500));
  if (!campaign) return cors(json({ error: 'Campaign not found' }, 404));
  const settings = (campaign.settings ?? {}) as SettingsBlob;
  if (!settings.tablePoints?.enabled) {
    return cors(
      json({ error: 'Table points are not enabled on this campaign' }, 409)
    );
  }

  // Pull all characters for this campaign and match in-process — case-
  // insensitive matching across two columns is awkward in SQL and the
  // table is small (one party).
  const { data: rows, error: charsErr } = await supabase
    .from('characters')
    .select('id, name, twitch_display_name, table_points')
    .eq('campaign_id', campaignId);
  if (charsErr) return cors(json({ error: 'Character read failed' }, 500));

  const lc = target.toLowerCase();
  const characters = (rows ?? []) as CharRow[];
  const byTwitch = characters.find(
    (c) => c.twitch_display_name && c.twitch_display_name.trim().toLowerCase() === lc
  );
  const byName = byTwitch
    ? null
    : characters.find((c) => c.name && c.name.trim().toLowerCase() === lc);
  const match = byTwitch ?? byName;
  if (!match) {
    return cors(
      json(
        {
          error: `No character matched "${target}" by twitch_display_name or name`,
          available: characters
            .map((c) => c.twitch_display_name ?? c.name)
            .filter(Boolean),
        },
        404
      )
    );
  }

  const current = match.table_points ?? 0;
  let next: number;
  if (hasDelta) {
    next = current + Math.trunc(body.delta as number);
  } else {
    next = Math.trunc(body.set as number);
  }
  if (next < 0) next = 0;

  const { error: writeErr } = await supabase
    .from('characters')
    .update({ table_points: next })
    .eq('id', match.id);
  if (writeErr) {
    return cors(
      json({ error: 'Points update failed', detail: writeErr.message }, 500)
    );
  }

  return cors(
    json(
      {
        ok: true,
        character: {
          id: match.id,
          name: match.name,
          twitch_display_name: match.twitch_display_name,
        },
        previous: current,
        current: next,
        matched_by: byTwitch ? 'twitch_display_name' : 'name',
      },
      200
    )
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
