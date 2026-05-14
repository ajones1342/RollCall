// Scene-preset webhook. Lets an external trigger (e.g. an OBS WebSocket
// script firing on SceneChanged) flip the campaign's active scene preset
// without anyone clicking in RollCall.
//
// Auth: same Bearer campaign token as /api/vtt/state. Body matches a preset
// by its `name` field (case-insensitive, trimmed) — names are GM-controlled
// strings, so the user can keep them in sync with OBS scene names. Pass an
// empty/null preset to clear (revert to per-character hides only).
//
//   POST /api/vtt/scene
//   Authorization: Bearer <campaign-token>
//   { "preset": "Stream end" }   // activate by name
//   { "preset": null }            // turn off
//   { "preset": "" }              // also turns off

import { adminClient, cors, getCampaignFromVttToken } from '../_lib/twitch';

export const config = { runtime: 'edge' };

type ScenePreset = {
  id: string;
  name: string;
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

  let body: { preset?: unknown };
  try {
    body = (await req.json()) as { preset?: unknown };
  } catch {
    return cors(json({ error: 'Invalid JSON body' }, 400));
  }

  const presetRaw = body.preset;
  const presetName =
    typeof presetRaw === 'string' ? presetRaw.trim() : presetRaw === null ? '' : null;
  if (presetName === null) {
    return cors(json({ error: '`preset` must be a string or null' }, 400));
  }

  const { data: campaign, error: readErr } = await supabase
    .from('campaigns')
    .select('settings')
    .eq('id', campaignId)
    .maybeSingle();
  if (readErr) return cors(json({ error: 'Campaign read failed' }, 500));
  if (!campaign) return cors(json({ error: 'Campaign not found' }, 404));

  const currentSettings = (campaign.settings ?? {}) as Record<string, unknown> & {
    scenePresets?: ScenePreset[];
  };
  const presets = Array.isArray(currentSettings.scenePresets)
    ? currentSettings.scenePresets
    : [];

  let activeId: string | null = null;
  let matchedName: string | null = null;
  if (presetName.length > 0) {
    const lc = presetName.toLowerCase();
    const match = presets.find(
      (p) => typeof p?.name === 'string' && p.name.trim().toLowerCase() === lc
    );
    if (!match) {
      return cors(
        json(
          {
            error: `No preset named "${presetName}"`,
            available: presets.map((p) => p?.name).filter(Boolean),
          },
          404
        )
      );
    }
    activeId = match.id;
    matchedName = match.name;
  }

  const newSettings = { ...currentSettings, activeScenePresetId: activeId };
  const { error: writeErr } = await supabase
    .from('campaigns')
    .update({ settings: newSettings })
    .eq('id', campaignId);
  if (writeErr) {
    return cors(json({ error: 'Settings update failed', detail: writeErr.message }, 500));
  }

  return cors(
    json(
      {
        ok: true,
        activeScenePresetId: activeId,
        name: matchedName,
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
