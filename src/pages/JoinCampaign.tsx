import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';

export default function JoinCampaign() {
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
      const twitchAvatar = meta?.['avatar_url'] ?? meta?.['picture'] ?? null;

      const { data: existing } = await supabase
        .from('characters')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        navigate(`/play/${campaignId}`, { replace: true });
        return;
      }

      const { error: insertErr } = await supabase.from('characters').insert({
        campaign_id: campaignId,
        user_id: userId,
        name: typeof twitchName === 'string' ? twitchName : '',
        twitch_display_name: typeof twitchName === 'string' ? twitchName : null,
        twitch_avatar_url: typeof twitchAvatar === 'string' ? twitchAvatar : null,
      });

      if (insertErr) {
        setError(insertErr.message);
        return;
      }
      navigate(`/play/${campaignId}`, { replace: true });
    })();
  }, [loading, session, campaignId, navigate]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'twitch',
      options: { redirectTo: `${window.location.origin}/join/${campaignId}` },
    });
  };

  if (loading) return <div className="p-8">Loading…</div>;

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-5xl mb-4 tracking-wider">Join the Party</h1>
        <p className="text-stone-400 mb-8">Sign in with Twitch to claim a character.</p>
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
      {error ? <p className="text-red-400">{error}</p> : <p>Joining campaign…</p>}
    </div>
  );
}
