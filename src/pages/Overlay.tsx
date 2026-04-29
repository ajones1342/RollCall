import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, type Character } from '../lib/types';

export default function Overlay() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [characters, setCharacters] = useState<Character[]>([]);

  useEffect(() => {
    document.body.classList.add('overlay-mode');
    return () => document.body.classList.remove('overlay-mode');
  }, []);

  useEffect(() => {
    if (!campaignId) return;

    const refresh = () =>
      supabase
        .from('characters')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('display_order', { ascending: true })
        .then(({ data }) => setCharacters((data as Character[]) ?? []));

    refresh();

    const channel = supabase
      .channel(`overlay:${campaignId}`)
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

  return (
    <div className="overlay-grid">
      {characters.map((ch) => (
        <CharacterCard key={ch.id} c={ch} />
      ))}
      <style>{`
        .overlay-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 16px;
          padding: 16px;
        }
        .card {
          color: #f5f5f4;
          text-shadow: 0 2px 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9);
          padding: 12px 16px;
        }
        .card .name {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.05em;
          line-height: 1.1;
        }
        .card .subtitle {
          font-size: 14px;
          letter-spacing: 0.08em;
          opacity: 0.9;
          margin-top: 2px;
        }
        .card .hp {
          font-size: 20px;
          margin-top: 8px;
        }
        .card .attrs {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 6px;
          margin-top: 8px;
          font-size: 14px;
        }
        .card .attr {
          text-align: center;
        }
        .card .attr .label {
          font-size: 11px;
          letter-spacing: 0.1em;
          opacity: 0.75;
        }
        .card .attr .value {
          font-size: 18px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

function CharacterCard({ c }: { c: Character }) {
  const sub = [c.race, c.class].filter(Boolean).join(' · ');
  return (
    <div className="card">
      <div className="name">{c.name || '—'}</div>
      {sub && <div className="subtitle">{sub}</div>}
      <div className="hp">
        HP {c.current_hp} / {c.max_hp}
      </div>
      <div className="attrs">
        {ATTRIBUTE_KEYS.map((key) => (
          <div className="attr" key={key}>
            <div className="label">{ATTRIBUTE_LABELS[key]}</div>
            <div className="value">{c[key]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
