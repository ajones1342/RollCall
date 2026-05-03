// VTT bridge webhook endpoint. Accepts a normalized payload from any VTT
// module (Fantasy Grounds Lua extension, Foundry module, Roll20 API script,
// etc.) and replaces the matching slots in campaigns.settings, plus an
// optional per-character partial update map.
//
// Auth: Bearer token in the Authorization header. Each campaign has a
// unique token in campaign_tokens; the GM views and rotates it on the
// campaign manage page.
//
// See docs/vtt-api.md for the payload shape.

import {
  adminClient,
  cors,
  getCampaignFromVttToken,
} from '../_lib/twitch';

export const config = { runtime: 'edge' };

// Whitelist of character fields a VTT module is allowed to update. Other
// fields (name, race, class, attributes, hidden_fields, notes, etc.) are
// owned by the player and shouldn't be overwritten by a VTT sync.
const ALLOWED_CHARACTER_FIELDS = new Set([
  'current_hp',
  'max_hp',
  'temp_hp',
  'conditions',
  'death_save_successes',
  'death_save_failures',
  'inspiration',
]);

function clampDeathSave(n: unknown): number | null {
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(3, Math.floor(n)));
}

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return cors(json({ error: 'Invalid JSON body' }, 400));
  }

  // ── 1. Settings updates (combat, lastRoll) ────────────────────
  const settingsAccepted: Record<string, unknown> = {};
  if (body.combat !== undefined) settingsAccepted.combat = body.combat;
  if (body.lastRoll !== undefined) settingsAccepted.lastRoll = body.lastRoll;

  if (Object.keys(settingsAccepted).length > 0) {
    const { data: campaign, error: readErr } = await supabase
      .from('campaigns')
      .select('settings')
      .eq('id', campaignId)
      .maybeSingle();
    if (readErr) return cors(json({ error: 'Campaign read failed' }, 500));
    if (!campaign) return cors(json({ error: 'Campaign not found' }, 404));

    const currentSettings = (campaign.settings ?? {}) as Record<string, unknown>;
    const newSettings = { ...currentSettings, ...settingsAccepted };

    const { error: writeErr } = await supabase
      .from('campaigns')
      .update({ settings: newSettings })
      .eq('id', campaignId);
    if (writeErr) {
      return cors(
        json({ error: 'Settings update failed', detail: writeErr.message }, 500)
      );
    }
  }

  // ── 2. Per-character partial updates ──────────────────────────
  const charactersUpdated: string[] = [];
  if (body.characters && typeof body.characters === 'object' && !Array.isArray(body.characters)) {
    const charsPayload = body.characters as Record<string, Record<string, unknown>>;
    const requestedIds = Object.keys(charsPayload);

    if (requestedIds.length > 0) {
      // Verify each character belongs to this campaign before update — RLS
      // is bypassed by the service-role client, so we enforce scoping here.
      const { data: existing } = await supabase
        .from('characters')
        .select('id')
        .eq('campaign_id', campaignId)
        .in('id', requestedIds);
      const validIds = new Set((existing ?? []).map((r: { id: string }) => r.id));

      // Build and apply updates per character. Sequential to keep error
      // handling simple; volume is low (one campaign, ~10 chars max).
      for (const id of requestedIds) {
        if (!validIds.has(id)) continue;
        const partial = charsPayload[id] ?? {};
        const update: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(partial)) {
          if (!ALLOWED_CHARACTER_FIELDS.has(k)) continue;
          if (k === 'death_save_successes' || k === 'death_save_failures') {
            const clamped = clampDeathSave(v);
            if (clamped !== null) update[k] = clamped;
            continue;
          }
          if (k === 'conditions') {
            if (Array.isArray(v)) {
              update[k] = v.filter((c) => typeof c === 'string');
            }
            continue;
          }
          if (k === 'inspiration') {
            if (typeof v === 'boolean') update[k] = v;
            continue;
          }
          if (k === 'current_hp' || k === 'max_hp' || k === 'temp_hp') {
            if (typeof v === 'number' && Number.isFinite(v)) {
              update[k] = Math.max(0, Math.floor(v));
            }
            continue;
          }
        }
        if (Object.keys(update).length === 0) continue;
        const { error } = await supabase
          .from('characters')
          .update(update)
          .eq('id', id);
        if (!error) charactersUpdated.push(id);
      }
    }
  }

  if (
    Object.keys(settingsAccepted).length === 0 &&
    charactersUpdated.length === 0 &&
    !(body.characters && Object.keys(body.characters as object).length > 0)
  ) {
    return cors(
      json(
        {
          error:
            'No accepted fields in payload (expected: combat, lastRoll, characters)',
        },
        400
      )
    );
  }

  return cors(
    json(
      {
        ok: true,
        applied: Object.keys(settingsAccepted),
        characters_updated: charactersUpdated,
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
