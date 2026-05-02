// Post a message to the campaign's broadcast channel chat.
// Auth: Supabase JWT (campaign owner). Server-side uses the broadcaster's
// stored Twitch token, refreshing it if needed.

import {
  adminClient,
  cors,
  getAuthedUser,
  getValidBroadcasterToken,
  jsonResponse,
  TWITCH_CLIENT_ID,
  userOwnsCampaign,
} from '../_lib/twitch';

export const config = { runtime: 'edge' };

const MAX_MESSAGE_LEN = 500;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  if (!TWITCH_CLIENT_ID) {
    return jsonResponse({ error: 'TWITCH_CLIENT_ID env var missing' }, 500);
  }

  let body: { campaignId?: string; message?: string };
  try {
    body = (await req.json()) as { campaignId?: string; message?: string };
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const campaignId = body.campaignId;
  const message = body.message?.trim();
  if (!campaignId) return jsonResponse({ error: 'Missing campaignId' }, 400);
  if (!message) return jsonResponse({ error: 'Missing message' }, 400);
  if (message.length > MAX_MESSAGE_LEN) {
    return jsonResponse(
      { error: `Message exceeds ${MAX_MESSAGE_LEN} chars` },
      400
    );
  }

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

  const result = await getValidBroadcasterToken(supabase, campaignId);
  if (!result) {
    return jsonResponse(
      {
        error:
          'Broadcast channel not linked or refresh failed. Reconnect on the campaign page.',
      },
      400
    );
  }
  const { token, row } = result;

  // POST to Helix. Broadcaster posts as themselves, so broadcaster_id and
  // sender_id are the same.
  const helixRes = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      broadcaster_id: row.broadcaster_id,
      sender_id: row.broadcaster_id,
      message,
    }),
  });

  if (!helixRes.ok) {
    const detail = await helixRes.text();
    return jsonResponse({ error: 'Twitch rejected message', detail }, 502);
  }
  const result_json = (await helixRes.json()) as {
    data: { message_id: string; is_sent: boolean; drop_reason?: { code: string; message: string } | null }[];
  };
  const sent = result_json.data?.[0];
  if (!sent || !sent.is_sent) {
    return jsonResponse(
      {
        error: 'Twitch did not send the message',
        drop_reason: sent?.drop_reason ?? null,
      },
      502
    );
  }

  return jsonResponse({ ok: true, message_id: sent.message_id }, 200);
}
