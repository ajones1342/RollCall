import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import type { Campaign } from '../lib/types';

export default function GMDashboard() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [newName, setNewName] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate('/', { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('campaigns')
      .select('*')
      .eq('owner_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setCampaigns((data as Campaign[]) ?? []));
  }, [session]);

  const createCampaign = async () => {
    if (!session || !newName.trim()) return;
    setWorking(true);
    const { data, error } = await supabase
      .from('campaigns')
      .insert({ name: newName.trim(), owner_id: session.user.id })
      .select()
      .single();
    setWorking(false);
    if (error) {
      alert(error.message);
      return;
    }
    setNewName('');
    if (data) navigate(`/gm/${data.id}`);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/', { replace: true });
  };

  if (loading) return <div className="p-8">Loading…</div>;

  return (
    <div className="min-h-screen p-8 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl tracking-wider">RollCall — GM</h1>
        <button onClick={signOut} className="text-sm text-stone-400 hover:text-stone-200">
          Sign out
        </button>
      </div>

      <section className="mb-10">
        <h2 className="text-2xl mb-3">New Campaign</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Campaign name"
            className="flex-1 bg-stone-800 px-4 py-2 rounded border border-stone-700"
          />
          <button
            onClick={createCampaign}
            disabled={working || !newName.trim()}
            className="px-5 py-2 bg-purple-700 hover:bg-purple-600 rounded disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-2xl mb-3">Your Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="text-stone-500">No campaigns yet.</p>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/gm/${c.id}`}
                  className="block bg-stone-800 hover:bg-stone-700 p-4 rounded border border-stone-700"
                >
                  <span className="text-xl">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
