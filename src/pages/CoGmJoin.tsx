// Co-GM invite landing page. Mirrors the player /join flow but inserts
// into campaign_co_gms instead of characters. Visitor signs in with
// Twitch (or is already signed in), then a row is added linking their
// auth user to the campaign.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';

export default function CoGmJoin() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !campaignId) return;
    if (!session) return; // wait for sign-in

    (async () => {
      const userId = session.user.id;
      const meta = session.user.user_metadata as Record<string, unknown> | undefined;
      const twitchName =
        (meta?.['custom_claims'] as Record<string, unknown> | undefined)?.['display_name'] ??
        meta?.['name'] ??
        meta?.['preferred_username'] ??
        meta?.['user_name'] ??
        null;

      // Already a co-GM? Just redirect.
      const { data: existing } = await supabase
        .from('campaign_co_gms')
        .select('user_id')
        .eq('campaign_id', campaignId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        navigate(`/gm/${campaignId}`, { replace: true });
        return;
      }

      // Already the owner? Don't double-add; just send to the GM page.
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('owner_id')
        .eq('id', campaignId)
        .maybeSingle();
      if (campaign && (campaign as { owner_id: string }).owner_id === userId) {
        navigate(`/gm/${campaignId}`, { replace: true });
        return;
      }

      const { error: insertErr } = await supabase.from('campaign_co_gms').insert({
        campaign_id: campaignId,
        user_id: userId,
        twitch_display_name: typeof twitchName === 'string' ? twitchName : null,
      });

      if (insertErr) {
        setError(insertErr.message);
        return;
      }
      navigate(`/gm/${campaignId}`, { replace: true });
    })();
  }, [loading, session, campaignId, navigate]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'twitch',
      options: { redirectTo: `${window.location.origin}/co-gm-join/${campaignId}` },
    });
  };

  if (loading) return <div className="p-8">Loading…</div>;

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-5xl mb-4 tracking-wider">Co-GM Invite</h1>
        <p className="text-stone-400 mb-8">
          Sign in with Twitch to accept the co-GM role for this campaign.
        </p>
        <button
          onClick={signIn}
          className="px-8 py-3 bg-purple-700 hover:bg-purple-600 rounded text-lg"
        >
          Sign in with Twitch
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 text-center">
      {error ? <p className="text-red-400">{error}</p> : <p>Joining as co-GM…</p>}
    </div>
  );
}
