// Create a Twitch native poll on the campaign's broadcast channel.
// Auth: Supabase JWT (campaign owner). Server-side uses the broadcaster's
// stored Twitch token (refreshed if needed) and POSTs to Helix /polls.
//
// Twitch handles the rest: viewers see the poll in the player UI, vote
// natively, results display in Twitch's overlay, the poll auto-closes
// after the duration.

import {
  adminClient,
  cors,
  getAuthedUser,
  getValidBroadcasterToken,
  jsonResponse,
  TWITCH_CLIENT_ID,
  userIsCampaignGM,
} from '../_lib/twitch';

export const config = { runtime: 'edge' };

const MIN_DURATION = 15;
const MAX_DURATION = 1800;
const MAX_TITLE_LEN = 60;
const MAX_CHOICE_LEN = 25;
const MIN_CHOICES = 2;
const MAX_CHOICES = 5;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  if (!TWITCH_CLIENT_ID) {
    return jsonResponse({ error: 'TWITCH_CLIENT_ID env var missing' }, 500);
  }

  let body: {
    campaignId?: string;
    title?: string;
    choices?: string[];
    durationSeconds?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const campaignId = body.campaignId;
  const title = body.title?.trim();
  const choices = (body.choices ?? [])
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const durationSeconds = body.durationSeconds;

  if (!campaignId) return jsonResponse({ error: 'Missing campaignId' }, 400);
  if (!title) return jsonResponse({ error: 'Missing title' }, 400);
  if (title.length > MAX_TITLE_LEN) {
    return jsonResponse({ error: `Title exceeds ${MAX_TITLE_LEN} chars` }, 400);
  }
  if (choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) {
    return jsonResponse(
      { error: `Need ${MIN_CHOICES}-${MAX_CHOICES} non-empty choices` },
      400
    );
  }
  if (choices.some((c) => c.length > MAX_CHOICE_LEN)) {
    return jsonResponse(
      { error: `Each choice must be ${MAX_CHOICE_LEN} chars or fewer` },
      400
    );
  }
  if (
    typeof durationSeconds !== 'number' ||
    durationSeconds < MIN_DURATION ||
    durationSeconds > MAX_DURATION
  ) {
    return jsonResponse(
      {
        error: `durationSeconds must be a number between ${MIN_DURATION} and ${MAX_DURATION}`,
      },
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

  const ok = await userIsCampaignGM(supabase, user.id, campaignId);
  if (!ok) return jsonResponse({ error: 'Not a GM on this campaign' }, 403);

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

  const helixRes = await fetch('https://api.twitch.tv/helix/polls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      broadcaster_id: row.broadcaster_id,
      title,
      choices: choices.map((title) => ({ title })),
      duration: durationSeconds,
    }),
  });

  if (!helixRes.ok) {
    const detail = await helixRes.text();
    // Most common 401: missing channel:manage:polls scope.
    if (helixRes.status === 401) {
      return jsonResponse(
        {
          error:
            'Twitch rejected the request. The broadcast channel may need to be reconnected to grant the polls permission.',
          detail,
        },
        401
      );
    }
    return jsonResponse({ error: 'Twitch rejected poll', detail }, 502);
  }

  const payload = (await helixRes.json()) as {
    data: { id: string; title: string; status: string; ends_at: string }[];
  };
  const poll = payload.data?.[0];
  if (!poll) {
    return jsonResponse({ error: 'Twitch returned no poll' }, 502);
  }

  return jsonResponse(
    {
      ok: true,
      poll_id: poll.id,
      title: poll.title,
      ends_at: poll.ends_at,
    },
    200
  );
}
