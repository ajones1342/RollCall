import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import type { Campaign, Character } from '../lib/types';

export default function CampaignManage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate('/', { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!campaignId) return;
    supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single()
      .then(({ data }) => setCampaign((data as Campaign) ?? null));

    const refresh = () =>
      supabase
        .from('characters')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('display_order', { ascending: true })
        .then(({ data }) => setCharacters((data as Character[]) ?? []));

    refresh();

    const channel = supabase
      .channel(`gm:${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` },
        () => refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const removeCharacter = async (id: string) => {
    if (!confirm('Remove this character from the campaign?')) return;
    const { error } = await supabase.from('characters').delete().eq('id', id);
    if (error) alert(error.message);
  };

  if (loading || !campaign) return <div className="p-8">Loading…</div>;

  const origin = window.location.origin;
  const joinUrl = `${origin}/join/${campaign.id}`;
  const overlayUrl = `${origin}/overlay/${campaign.id}`;

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <Link to="/gm" className="text-sm text-stone-400 hover:text-stone-200">
        ← Campaigns
      </Link>
      <h1 className="text-4xl tracking-wider mt-2 mb-6">{campaign.name}</h1>

      <section className="mb-8 grid gap-3">
        <UrlRow
          label="Player Join Link"
          value={joinUrl}
          copied={copied === 'join'}
          onCopy={() => copy('join', joinUrl)}
          hint="Share this with your players. They sign in with Twitch and get their own character."
        />
        <UrlRow
          label="Overlay (preview — all characters)"
          value={overlayUrl}
          copied={copied === 'overlay'}
          onCopy={() => copy('overlay', overlayUrl)}
          hint="Useful for previewing layouts. For OBS, use the per-character URLs below — one Browser Source per player."
        />
      </section>

      <section>
        <h2 className="text-2xl mb-3">Party ({characters.length})</h2>
        {characters.length === 0 ? (
          <p className="text-stone-500">No players have joined yet.</p>
        ) : (
          <ul className="space-y-3">
            {characters.map((ch) => {
              const charOverlayUrl = `${origin}/overlay/${campaign.id}/${ch.id}`;
              const copyKey = `char:${ch.id}`;
              return (
                <li
                  key={ch.id}
                  className="bg-stone-800 border border-stone-700 rounded p-4"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-xl">{ch.name || '(unnamed)'}</div>
                      <div className="text-sm text-stone-400">
                        {ch.race || '—'} {ch.class || '—'} · HP {ch.current_hp}/{ch.max_hp}
                        {ch.twitch_display_name && (
                          <span className="ml-2 text-purple-400">
                            @{ch.twitch_display_name}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="text-xs text-stone-300 bg-stone-900 px-2 py-1 rounded truncate flex-1">
                          {charOverlayUrl}
                        </code>
                        <button
                          onClick={() => copy(copyKey, charOverlayUrl)}
                          className="text-xs px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded whitespace-nowrap"
                        >
                          {copied === copyKey ? 'Copied!' : 'Copy overlay URL'}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => removeCharacter(ch.id)}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function UrlRow(props: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  hint: string;
}) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded p-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm uppercase tracking-wide text-stone-400">{props.label}</span>
        <button
          onClick={props.onCopy}
          className="text-sm px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded"
        >
          {props.copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <code className="block text-sm text-stone-200 break-all">{props.value}</code>
      <p className="text-xs text-stone-500 mt-2">{props.hint}</p>
    </div>
  );
}
