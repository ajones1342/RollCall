import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  HIDEABLE_FIELDS,
  STANDARD_CONDITIONS,
  normalizeHiddenFields,
  type AttributeKey,
  type Campaign,
  type Character,
  type HideableField,
} from '../lib/types';

type Draft = Pick<
  Character,
  | 'name'
  | 'race'
  | 'class'
  | 'max_hp'
  | 'current_hp'
  | 'temp_hp'
  | AttributeKey
  | 'hidden_fields'
  | 'conditions'
  | 'death_save_successes'
  | 'death_save_failures'
  | 'inspiration'
  | 'notes'
>;

const blankDraft: Draft = {
  name: '',
  race: '',
  class: '',
  max_hp: 1,
  current_hp: 1,
  temp_hp: 0,
  strength: 10,
  agility: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  hidden_fields: [],
  conditions: [],
  death_save_successes: 0,
  death_save_failures: 0,
  inspiration: false,
  notes: '',
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
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [partyMembers, setPartyMembers] = useState<Character[]>([]);
  const [partyOpen, setPartyOpen] = useState(true);
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
      const ch: Character = {
        ...(data as Character),
        hidden_fields: normalizeHiddenFields((data as Character).hidden_fields),
      };
      setCharacter(ch);
      setDraft(toDraft(ch));
    });
  }, [session, campaignId, characterId, navigate]);

  // Party Information panel: fetch all characters + campaign settings,
  // subscribe to live updates so HP changes / condition flips show up.
  useEffect(() => {
    if (!campaignId) return;

    const refreshCampaign = () =>
      supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .maybeSingle()
        .then(({ data }) => setCampaign((data as Campaign) ?? null));

    const refreshParty = () =>
      supabase
        .from('characters')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('display_order', { ascending: true })
        .then(({ data }) => setPartyMembers((data as Character[]) ?? []));

    refreshCampaign();
    refreshParty();

    const channel = supabase
      .channel(`party:${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'characters',
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => refreshParty()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaigns',
          filter: `id=eq.${campaignId}`,
        },
        () => refreshCampaign()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

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

  const toggleCondition = (cond: string) => {
    setDraft((d) => {
      const has = d.conditions.includes(cond);
      return {
        ...d,
        conditions: has
          ? d.conditions.filter((c) => c !== cond)
          : [...d.conditions, cond],
      };
    });
  };

  const setDeathSaves = (successes: number, failures: number) => {
    setDraft((d) => ({
      ...d,
      death_save_successes: clampDeathSave(successes),
      death_save_failures: clampDeathSave(failures),
    }));
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="sm:col-span-2">
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
        <Field label="Temp HP">
          <input
            type="number"
            value={draft.temp_hp}
            onChange={(e) =>
              setField('temp_hp', Math.max(0, parseInt(e.target.value || '0', 10)))
            }
            className="input"
          />
        </Field>
      </div>

      <h2 className="text-xl mb-2">Combat State</h2>
      <div className="bg-stone-800 border border-stone-700 rounded p-4 mb-6 space-y-4">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.inspiration}
            onChange={(e) => setField('inspiration', e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-stone-200">Inspiration ★</span>
        </label>

        <div>
          <span className="text-xs uppercase tracking-wide text-stone-400 mb-1 block">
            Death Saves
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <SaveDots
              label="Successes"
              count={draft.death_save_successes}
              filledColor="bg-emerald-500"
              onSet={(n) => setDeathSaves(n, draft.death_save_failures)}
            />
            <SaveDots
              label="Failures"
              count={draft.death_save_failures}
              filledColor="bg-red-500"
              onSet={(n) => setDeathSaves(draft.death_save_successes, n)}
            />
            <button
              onClick={() => setDeathSaves(0, 0)}
              className="text-xs text-stone-400 hover:text-stone-200 underline ml-auto"
            >
              Reset
            </button>
          </div>
        </div>

        <div>
          <span className="text-xs uppercase tracking-wide text-stone-400 mb-1 block">
            Conditions
          </span>
          <div className="flex flex-wrap gap-1.5">
            {STANDARD_CONDITIONS.map((cond) => {
              const active = draft.conditions.includes(cond);
              return (
                <button
                  key={cond}
                  onClick={() => toggleCondition(cond)}
                  className={
                    'text-sm px-2.5 py-1 rounded border transition-colors ' +
                    (active
                      ? 'bg-amber-700 border-amber-600 text-amber-50'
                      : 'bg-stone-900 border-stone-600 text-stone-400 hover:text-stone-200')
                  }
                >
                  {cond}
                </button>
              );
            })}
          </div>
        </div>
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

      <PartyInformation
        members={partyMembers}
        currentUserId={session?.user.id}
        respectHideToggles={Boolean(campaign?.settings?.partyViewRespectsHideToggles)}
        open={partyOpen}
        onToggle={() => setPartyOpen((v) => !v)}
      />

      <h2 className="text-xl mb-2">Notes</h2>
      <p className="text-sm text-stone-500 mb-2">
        Personal scratch space for the player and GM. Not shown on the overlay.
      </p>
      <textarea
        value={draft.notes}
        onChange={(e) => setField('notes', e.target.value)}
        rows={6}
        className="input resize-y mb-8"
      />

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

function PartyInformation(props: {
  members: Character[];
  currentUserId?: string;
  respectHideToggles: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (props.members.length === 0) return null;

  return (
    <section className="mb-8">
      <button
        onClick={props.onToggle}
        className="w-full flex items-center justify-between gap-2 mb-2 text-left"
      >
        <h2 className="text-xl">Party Information</h2>
        <span className="text-sm text-stone-400">
          {props.members.length} {props.members.length === 1 ? 'member' : 'members'} ·{' '}
          {props.open ? 'hide' : 'show'}
        </span>
      </button>
      {props.open && (
        <div className="space-y-2">
          {props.members.map((m) => (
            <PartyMemberRow
              key={m.id}
              c={m}
              isSelf={m.user_id === props.currentUserId}
              respectHideToggles={props.respectHideToggles}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PartyMemberRow(props: {
  c: Character;
  isSelf: boolean;
  respectHideToggles: boolean;
}) {
  const c = props.c;
  const hidden = props.respectHideToggles
    ? new Set(normalizeHiddenFields(c.hidden_fields))
    : new Set<string>();
  const showRace = !hidden.has('race') && Boolean(c.race);
  const showClass = !hidden.has('class') && Boolean(c.class);
  const subtitleParts = [showRace ? c.race : null, showClass ? c.class : null].filter(
    (p): p is string => Boolean(p)
  );
  const subtitle = subtitleParts.join(' · ');
  const conditions = (c.conditions ?? []).filter(Boolean);
  const showName = !hidden.has('name');
  const showInspiration = !hidden.has('inspiration') && Boolean(c.inspiration);
  const showHp = !hidden.has('hp');
  const showConditions = !hidden.has('conditions') && conditions.length > 0;
  const showAttributes = !hidden.has('attributes');
  const tempHp = c.temp_hp ?? 0;

  return (
    <div
      className={
        'rounded border p-3 ' +
        (props.isSelf
          ? 'bg-stone-800 border-purple-700/60'
          : 'bg-stone-800 border-stone-700')
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-lg">
          {showInspiration && <span className="text-amber-400 mr-1.5">★</span>}
          {showName ? c.name || '—' : '—'}
          {props.isSelf && (
            <span className="text-xs text-purple-400 ml-2">(you)</span>
          )}
        </div>
        {showHp && (
          <div className="text-sm text-stone-300 tabular-nums whitespace-nowrap">
            HP {c.current_hp}/{c.max_hp}
            {tempHp > 0 && (
              <span className="text-emerald-400 ml-1">+{tempHp}</span>
            )}
          </div>
        )}
      </div>
      {subtitle && (
        <div className="text-sm text-stone-400 mt-0.5">{subtitle}</div>
      )}
      {showConditions && (
        <div className="text-sm text-amber-300 italic mt-1">
          {conditions.map((cn) => cn.toLowerCase()).join(', ')}
        </div>
      )}
      {showAttributes && (
        <div className="grid grid-cols-6 gap-2 mt-2 text-center text-sm">
          {ATTRIBUTE_KEYS.map((k) => (
            <div key={k} className="bg-stone-900 rounded py-1">
              <div className="text-[10px] uppercase text-stone-500 tracking-wide">
                {ATTRIBUTE_LABELS[k]}
              </div>
              <div className="text-stone-200 tabular-nums">{c[k]}</div>
            </div>
          ))}
        </div>
      )}
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

function SaveDots(props: {
  label: string;
  count: number;
  filledColor: string;
  onSet: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-stone-400">
        {props.label}
      </span>
      <div className="flex gap-1">
        {[1, 2, 3].map((n) => {
          const filled = props.count >= n;
          return (
            <button
              key={n}
              onClick={() => props.onSet(filled && props.count === n ? n - 1 : n)}
              className={
                'w-6 h-6 rounded-full border-2 transition-colors ' +
                (filled
                  ? `${props.filledColor} border-transparent`
                  : 'bg-transparent border-stone-500 hover:border-stone-300')
              }
              aria-label={`${props.label} ${n}`}
            />
          );
        })}
      </div>
    </div>
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

function clampDeathSave(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 3) return 3;
  return n;
}

function toDraft(ch: Character): Draft {
  return {
    name: ch.name,
    race: ch.race,
    class: ch.class,
    max_hp: ch.max_hp,
    current_hp: ch.current_hp,
    temp_hp: ch.temp_hp ?? 0,
    strength: ch.strength,
    agility: ch.agility,
    constitution: ch.constitution,
    intelligence: ch.intelligence,
    wisdom: ch.wisdom,
    charisma: ch.charisma,
    hidden_fields: normalizeHiddenFields(ch.hidden_fields),
    conditions: ch.conditions ?? [],
    death_save_successes: ch.death_save_successes ?? 0,
    death_save_failures: ch.death_save_failures ?? 0,
    inspiration: ch.inspiration ?? false,
    notes: ch.notes ?? '',
  };
}

function draftDiffers(draft: Draft, ch: Character): boolean {
  for (const k of Object.keys(draft) as (keyof Draft)[]) {
    if (k === 'hidden_fields' || k === 'conditions') {
      if (!sameStringSet(draft[k] as string[], (ch[k] as string[]) ?? [])) {
        return true;
      }
      continue;
    }
    if (draft[k] !== ch[k]) return true;
  }
  return false;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}
