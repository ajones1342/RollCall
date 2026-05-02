// VTT bridge webhook endpoint. Accepts a normalized payload from any VTT
// module (Fantasy Grounds Lua extension, Foundry module, Roll20 API script,
// etc.) and replaces the matching slots in campaigns.settings.
//
// Auth: Bearer token in the Authorization header. Each campaign has a
// unique token in campaign_tokens; the GM views and rotates it on the
// campaign manage page.
//
// Required Vercel env vars:
//   SUPABASE_URL                 — your project URL
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (server-side only, NEVER exposed)
//
// See docs/vtt-api.md for the payload shape.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }));
  }
  if (req.method !== 'POST') {
    return cors(json({ error: 'Method not allowed' }, 405));
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return cors(
      json(
        {
          error:
            'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing',
        },
        500
      )
    );
  }

  const auth = req.headers.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    return cors(json({ error: 'Missing Bearer token' }, 401));
  }
  const token = auth.slice(7).trim();
  if (!token) {
    return cors(json({ error: 'Empty token' }, 401));
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tokenRow, error: tokenErr } = await supabase
    .from('campaign_tokens')
    .select('campaign_id')
    .eq('token', token)
    .maybeSingle();

  if (tokenErr) {
    return cors(json({ error: 'Token lookup failed' }, 500));
  }
  if (!tokenRow) {
    return cors(json({ error: 'Invalid token' }, 401));
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return cors(json({ error: 'Invalid JSON body' }, 400));
  }

  // Whitelist accepted top-level keys. Everything else is ignored, so a VTT
  // module sending extra fields doesn't get rejected.
  const accepted: Record<string, unknown> = {};
  if (body.combat !== undefined) accepted.combat = body.combat;
  if (body.lastRoll !== undefined) accepted.lastRoll = body.lastRoll;

  if (Object.keys(accepted).length === 0) {
    return cors(
      json(
        { error: 'No accepted fields in payload (expected: combat, lastRoll)' },
        400
      )
    );
  }

  const { data: campaign, error: readErr } = await supabase
    .from('campaigns')
    .select('settings')
    .eq('id', tokenRow.campaign_id)
    .maybeSingle();

  if (readErr) return cors(json({ error: 'Campaign read failed' }, 500));
  if (!campaign) return cors(json({ error: 'Campaign not found' }, 404));

  const currentSettings = (campaign.settings ?? {}) as Record<string, unknown>;
  const newSettings = { ...currentSettings, ...accepted };

  const { error: writeErr } = await supabase
    .from('campaigns')
    .update({ settings: newSettings })
    .eq('id', tokenRow.campaign_id);

  if (writeErr) {
    return cors(json({ error: 'Update failed', detail: writeErr.message }, 500));
  }

  return cors(json({ ok: true, applied: Object.keys(accepted) }, 200));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// CORS headers — VTT modules running locally (Foundry server, FG client) may
// hit this endpoint cross-origin. Allow all origins; auth is via Bearer token.
function cors(res: Response): Response {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}
