import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, type AttributeKey, type Character } from '../lib/types';

type Draft = Pick<
  Character,
  'name' | 'race' | 'class' | 'max_hp' | 'current_hp' | AttributeKey
>;

const blankDraft: Draft = {
  name: '',
  race: '',
  class: '',
  max_hp: 1,
  current_hp: 1,
  strength: 10,
  agility: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

export default function PlayerEdit() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate(`/join/${campaignId}`, { replace: true });
  }, [loading, session, campaignId, navigate]);

  useEffect(() => {
    if (!session || !campaignId) return;
    supabase
      .from('characters')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          navigate(`/join/${campaignId}`, { replace: true });
          return;
        }
        const ch = data as Character;
        setCharacter(ch);
        setDraft({
          name: ch.name,
          race: ch.race,
          class: ch.class,
          max_hp: ch.max_hp,
          current_hp: ch.current_hp,
          strength: ch.strength,
          agility: ch.agility,
          constitution: ch.constitution,
          intelligence: ch.intelligence,
          wisdom: ch.wisdom,
          charisma: ch.charisma,
        });
      });
  }, [session, campaignId, navigate]);

  const dirty = useMemo(() => {
    if (!character) return false;
    return (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== character[k]);
  }, [draft, character]);

  const save = async () => {
    if (!character) return;
    const { error } = await supabase
      .from('characters')
      .update(draft)
      .eq('id', character.id);
    if (error) {
      alert(error.message);
      return;
    }
    setCharacter({ ...character, ...draft });
    setSavedAt(Date.now());
  };

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  if (loading || !character) return <div className="p-8">Loading…</div>;

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto">
      <h1 className="text-3xl tracking-wider mb-6">Character Sheet</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => setField('name', e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Race">
          <input
            value={draft.race}
            onChange={(e) => setField('race', e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Class">
          <input
            value={draft.class}
            onChange={(e) => setField('class', e.target.value)}
            className="input"
          />
        </Field>
        <div />
        <Field label="Current HP">
          <input
            type="number"
            value={draft.current_hp}
            onChange={(e) => setField('current_hp', parseInt(e.target.value || '0', 10))}
            className="input"
          />
        </Field>
        <Field label="Max HP">
          <input
            type="number"
            value={draft.max_hp}
            onChange={(e) => setField('max_hp', parseInt(e.target.value || '0', 10))}
            className="input"
          />
        </Field>
      </div>

      <h2 className="text-xl mb-2">Attributes</h2>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-8">
        {ATTRIBUTE_KEYS.map((key) => (
          <Field key={key} label={ATTRIBUTE_LABELS[key]}>
            <input
              type="number"
              value={draft[key]}
              onChange={(e) => setField(key, parseInt(e.target.value || '0', 10))}
              className="input text-center"
            />
          </Field>
        ))}
      </div>

      <div className="flex items-center gap-3 sticky bottom-0 bg-stone-900 py-3">
        <button
          onClick={save}
          disabled={!dirty}
          className="px-6 py-2 bg-purple-700 hover:bg-purple-600 rounded disabled:opacity-40"
        >
          Save
        </button>
        {savedAt && !dirty && (
          <span className="text-sm text-stone-400">Saved.</span>
        )}
        {dirty && <span className="text-sm text-amber-400">Unsaved changes</span>}
      </div>

      <style>{`
        .input {
          width: 100%;
          background: rgb(41 37 36);
          border: 1px solid rgb(68 64 60);
          border-radius: 4px;
          padding: 8px 10px;
          color: white;
          font-family: inherit;
        }
      `}</style>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-stone-400 mb-1">{props.label}</span>
      {props.children}
    </label>
  );
}
