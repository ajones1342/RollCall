import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';

export default function Landing() {
  const { session, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate('/gm', { replace: true });
  }, [loading, session, navigate]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'twitch',
      options: { redirectTo: `${window.location.origin}/gm` },
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-7xl mb-4 tracking-wider font-bold">RollCall</h1>
      <p className="text-stone-400 mb-10 max-w-md">
        Live D&amp;D character overlays for Twitch streams.
      </p>
      <button
        onClick={signIn}
        className="px-8 py-3 bg-purple-700 hover:bg-purple-600 rounded text-lg tracking-wide"
      >
        Sign in with Twitch
      </button>
    </div>
  );
}
