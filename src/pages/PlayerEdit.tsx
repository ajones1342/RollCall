import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  HIDEABLE_FIELDS,
  type AttributeKey,
  type Character,
  type HideableField,
} from '../lib/types';

type Draft = Pick<
  Character,
  'name' | 'race' | 'class' | 'max_hp' | 'current_hp' | AttributeKey | 'hidden_fields'
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
  hidden_fields: [],
};

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export default function PlayerEdit() {
  const { campaignId, characterId } = useParams<{
    campaignId: string;
    characterId?: string;
  }>();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading || session) return;
    if (characterId) navigate('/', { replace: true });
    else navigate(`/join/${campaignId}`, { replace: true });
  }, [loading, session, campaignId, characterId, navigate]);

  useEffect(() => {
    if (!session || !campaignId) return;
    const query = supabase.from('characters').select('*').eq('campaign_id', campaignId);
    if (characterId) {
      query.eq('id', characterId);
    } else {
      query.eq('user_id', session.user.id);
    }
    query.maybeSingle().then(({ data }) => {
      if (!data) {
        if (characterId) navigate(`/gm/${campaignId}`, { replace: true });
        else navigate(`/join/${campaignId}`, { replace: true });
        return;
      }
      const ch = data as Character;
      setCharacter(ch);
      setDraft(toDraft(ch));
    });
  }, [session, campaignId, characterId, navigate]);

  const dirty = useMemo(() => {
    if (!character) return false;
    return draftDiffers(draft, character);
  }, [draft, character]);

  // Auto-save with debounce.
  useEffect(() => {
    if (!character || !dirty) return;
    setSaveState('pending');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      setSaveState('saving');
      const { error } = await supabase
        .from('characters')
        .update(draft)
        .eq('id', character.id);
      if (error) {
        setSaveState('error');
        setErrorMsg(error.message);
        return;
      }
      setCharacter({ ...character, ...draft });
      setErrorMsg(null);
      setSaveState('saved');
    }, 600);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [draft, character, dirty]);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const bumpHP = (delta: number) => {
    setDraft((d) => ({ ...d, current_hp: Math.max(0, d.current_hp + delta) }));
  };

  const toggleHidden = (key: HideableField) => {
    setDraft((d) => {
      const has = d.hidden_fields.includes(key);
      return {
        ...d,
        hidden_fields: has
          ? d.hidden_fields.filter((f) => f !== key)
          : [...d.hidden_fields, key],
      };
    });
  };

  if (loading || !character) return <div className="p-8">Loading…</div>;

  const editingAsGM = Boolean(characterId) && character.user_id !== session?.user.id;

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto">
      <h1 className="text-3xl tracking-wider mb-1">Character Sheet</h1>
      {editingAsGM && (
        <p className="text-sm text-purple-400 mb-4">
          Editing as GM: {character.name || '(unnamed)'}
          {character.twitch_display_name && ` — @${character.twitch_display_name}`}
        </p>
      )}

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
      </div>

      <h2 className="text-xl mb-2">Hit Points</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div>
          <span className="text-xs uppercase tracking-wide text-stone-400 mb-1 block">
            Current HP
          </span>
          <div className="flex gap-1">
            <HPButton onClick={() => bumpHP(-5)}>−5</HPButton>
            <HPButton onClick={() => bumpHP(-1)}>−1</HPButton>
            <input
              type="number"
              value={draft.current_hp}
              onChange={(e) =>
                setField('current_hp', parseInt(e.target.value || '0', 10))
              }
              className="input text-center"
            />
            <HPButton onClick={() => bumpHP(+1)}>+1</HPButton>
            <HPButton onClick={() => bumpHP(+5)}>+5</HPButton>
          </div>
        </div>
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

      <h2 className="text-xl mb-2">Show on Overlay</h2>
      <p className="text-sm text-stone-500 mb-3">
        Untick to hide that field from the OBS overlay.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
        {HIDEABLE_FIELDS.map(({ key, label }) => {
          const visible = !draft.hidden_fields.includes(key);
          return (
            <label
              key={key}
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={visible}
                onChange={() => toggleHidden(key)}
                className="w-4 h-4"
              />
              <span className="text-stone-200">{label}</span>
            </label>
          );
        })}
      </div>

      <div className="sticky bottom-0 bg-stone-900 py-3">
        <SaveIndicator state={saveState} dirty={dirty} error={errorMsg} />
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

function HPButton(props: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className="px-3 py-2 bg-stone-700 hover:bg-stone-600 active:bg-stone-500 rounded text-sm font-semibold min-w-[56px]"
    >
      {props.children}
    </button>
  );
}

function SaveIndicator(props: {
  state: SaveState;
  dirty: boolean;
  error: string | null;
}) {
  if (props.state === 'error') {
    return (
      <span className="text-sm text-red-400">
        Save failed: {props.error}
      </span>
    );
  }
  if (props.state === 'saving') {
    return <span className="text-sm text-stone-400">Saving…</span>;
  }
  if (props.state === 'pending' || props.dirty) {
    return <span className="text-sm text-amber-400">Unsaved changes…</span>;
  }
  if (props.state === 'saved') {
    return <span className="text-sm text-emerald-400">Saved.</span>;
  }
  return null;
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-stone-400 mb-1">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

function toDraft(ch: Character): Draft {
  return {
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
    hidden_fields: ch.hidden_fields ?? [],
  };
}

function draftDiffers(draft: Draft, ch: Character): boolean {
  for (const k of Object.keys(draft) as (keyof Draft)[]) {
    if (k === 'hidden_fields') {
      const a = draft.hidden_fields;
      const b = ch.hidden_fields ?? [];
      if (a.length !== b.length) return true;
      const sa = [...a].sort();
      const sb = [...b].sort();
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return true;
      continue;
    }
    if (draft[k] !== ch[k]) return true;
  }
  return false;
}
