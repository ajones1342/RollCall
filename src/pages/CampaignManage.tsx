import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import {
  advanceTurn,
  previousTurn,
  rollDice,
  sortByInitiative,
  type Campaign,
  type Character,
  type CombatState,
  type Combatant,
  type DiceRoll,
} from '../lib/types';

export default function CampaignManage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [vttToken, setVttToken] = useState<string | null>(null);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [broadcaster, setBroadcaster] = useState<{
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_display_name: string;
    scopes: string[];
  } | null>(null);
  const [broadcasterFlash, setBroadcasterFlash] = useState<string | null>(null);

  // Require an 8px drag distance before activating — prevents click-to-edit
  // from accidentally triggering a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

    // Token lookup is gated by RLS to the campaign owner only.
    supabase
      .from('campaign_tokens')
      .select('token')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data }) => setVttToken((data as { token: string } | null)?.token ?? null));

    refreshBroadcaster();

    // If we just came back from the Twitch OAuth callback, surface a brief
    // success flash and strip the query param.
    const url = new URL(window.location.href);
    if (url.searchParams.get('broadcaster') === 'linked') {
      setBroadcasterFlash('Broadcast channel linked.');
      window.setTimeout(() => setBroadcasterFlash(null), 3000);
      url.searchParams.delete('broadcaster');
      window.history.replaceState({}, '', url.toString());
    } else if (url.searchParams.has('broadcaster_error')) {
      setBroadcasterFlash(
        'Broadcast channel link failed: ' + url.searchParams.get('broadcaster_error')
      );
      window.setTimeout(() => setBroadcasterFlash(null), 5000);
      url.searchParams.delete('broadcaster_error');
      window.history.replaceState({}, '', url.toString());
    }

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
        {
          event: '*',
          schema: 'public',
          table: 'characters',
          filter: `campaign_id=eq.${campaignId}`,
        },
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

  const bumpHp = async (id: string, delta: number, current: number) => {
    const next = Math.max(0, current + delta);
    setCharacters((cs) =>
      cs.map((c) => (c.id === id ? { ...c, current_hp: next } : c))
    );
    const { error } = await supabase
      .from('characters')
      .update({ current_hp: next })
      .eq('id', id);
    if (error) alert(error.message);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = characters.findIndex((c) => c.id === active.id);
    const newIndex = characters.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(characters, oldIndex, newIndex);
    setCharacters(reordered); // optimistic
    await Promise.all(
      reordered.map((c, i) =>
        supabase.from('characters').update({ display_order: i }).eq('id', c.id)
      )
    );
  };

  // ─── Twitch alert triggers ────────────────────────────────────
  const prevCharsRef = useRef<Map<string, Character> | null>(null);
  const prevCombatRef = useRef<CombatState | undefined>(undefined);

  const fireAlert = async (message: string) => {
    if (!campaign) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    // Fire-and-forget — alerts shouldn't block UI on Twitch latency.
    fetch('/api/twitch/post-chat', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ campaignId: campaign.id, message }),
    }).catch(() => {});
  };

  // Detect HP transitions on characters. We compare each character's current
  // state to the previous snapshot stored in a ref. Skip the first run (when
  // prev is null) so we don't alert on initial load. Realtime echoes won't
  // double-fire because by then prev matches current.
  useEffect(() => {
    if (!campaign || !broadcaster) {
      prevCharsRef.current = new Map(characters.map((c) => [c.id, c]));
      return;
    }
    const alerts = campaign.settings?.alerts ?? {};
    const prev = prevCharsRef.current;
    if (prev) {
      for (const c of characters) {
        const before = prev.get(c.id);
        if (!before) continue;
        if (c.current_hp >= before.current_hp) continue; // not damage
        const max = Math.max(1, c.max_hp);
        const beforePct = before.current_hp / Math.max(1, before.max_hp);
        const afterPct = c.current_hp / max;
        // Hit 0 takes priority over the bloodied alert.
        if (alerts.onZeroHp && before.current_hp > 0 && c.current_hp === 0) {
          fireAlert(`💀 ${c.name || 'Unnamed'} is down (0 HP).`);
        } else if (alerts.onLowHp && beforePct > 0.25 && afterPct <= 0.25 && c.current_hp > 0) {
          fireAlert(
            `🩸 ${c.name || 'Unnamed'} is bloodied: HP ${c.current_hp}/${c.max_hp}.`
          );
        }
      }
    }
    prevCharsRef.current = new Map(characters.map((c) => [c.id, c]));
  }, [characters, campaign, broadcaster]);

  // Detect round / turn advances on combat state.
  useEffect(() => {
    if (!campaign || !broadcaster) {
      prevCombatRef.current = campaign?.settings?.combat;
      return;
    }
    const alerts = campaign.settings?.alerts ?? {};
    const prev = prevCombatRef.current;
    const cur = campaign.settings?.combat;
    if (
      alerts.onRoundAdvance &&
      prev?.active &&
      cur?.active &&
      (prev.round !== cur.round || prev.activeIndex !== cur.activeIndex)
    ) {
      const active = cur.combatants[cur.activeIndex];
      if (active) {
        fireAlert(`🎯 Round ${cur.round} — ${active.name}'s turn.`);
      }
    }
    prevCombatRef.current = cur;
  }, [campaign, broadcaster]);
  // ─── /Twitch alert triggers ───────────────────────────────────

  const refreshBroadcaster = () => {
    if (!campaignId) return;
    supabase
      .from('campaign_broadcasters')
      .select('broadcaster_id, broadcaster_login, broadcaster_display_name, scopes')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data }) => setBroadcaster(data as typeof broadcaster));
  };

  const connectBroadcaster = async () => {
    if (!campaign) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const r = await fetch('/api/twitch/sign-link', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ campaignId: campaign.id }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(`Failed to start broadcaster link: ${err.error ?? r.statusText}`);
      return;
    }
    const { authorizeUrl } = (await r.json()) as { authorizeUrl: string };
    window.location.href = authorizeUrl;
  };

  const disconnectBroadcaster = async () => {
    if (!campaign) return;
    if (!confirm('Disconnect the broadcast channel?')) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const r = await fetch('/api/twitch/disconnect', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ campaignId: campaign.id }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(`Failed to disconnect: ${err.error ?? r.statusText}`);
      return;
    }
    setBroadcaster(null);
  };

  const regenerateToken = async () => {
    if (!campaign) return;
    if (
      !confirm(
        'Regenerate the VTT token? Any module using the old token will stop working until you update it.'
      )
    )
      return;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const newToken = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const { error } = await supabase
      .from('campaign_tokens')
      .update({ token: newToken })
      .eq('campaign_id', campaign.id);
    if (error) {
      alert(error.message);
      return;
    }
    setVttToken(newToken);
  };

  const setSetting = async <K extends keyof NonNullable<Campaign['settings']>>(
    key: K,
    value: NonNullable<Campaign['settings']>[K]
  ) => {
    if (!campaign) return;
    const newSettings = { ...(campaign.settings ?? {}), [key]: value };
    setCampaign({ ...campaign, settings: newSettings }); // optimistic
    const { error } = await supabase
      .from('campaigns')
      .update({ settings: newSettings })
      .eq('id', campaign.id);
    if (error) alert(error.message);
  };

  if (loading || !campaign) return <div className="p-8">Loading…</div>;

  const origin = window.location.origin;
  const joinUrl = `${origin}/join/${campaign.id}`;
  const overlayUrl = `${origin}/overlay/${campaign.id}`;
  const combatOverlayUrl = `${origin}/overlay/${campaign.id}/combat`;

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <Link to="/gm" className="text-sm text-stone-400 hover:text-stone-200">
        ← Campaigns
      </Link>
      <div className="flex items-baseline justify-between gap-4 mt-2 mb-6">
        <h1 className="text-4xl tracking-wider">{campaign.name}</h1>
        <Link
          to={`/gm/${campaign.id}/theme`}
          className="text-sm px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded whitespace-nowrap"
        >
          Edit overlay theme
        </Link>
      </div>

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
        <UrlRow
          label="Combat Tracker URL"
          value={combatOverlayUrl}
          copied={copied === 'combat-overlay'}
          onCopy={() => copy('combat-overlay', combatOverlayUrl)}
          hint="Add as a Browser Source in OBS. Renders the round + initiative order + per-PC HP / inspiration / conditions. Stays invisible when no combat is active."
        />
      </section>

      <section className="mb-8 bg-stone-800 border border-stone-700 rounded p-4">
        <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
          <h2 className="text-xl">Broadcast Channel</h2>
          {broadcaster ? (
            <button
              onClick={disconnectBroadcaster}
              className="text-xs px-3 py-1 bg-stone-700 hover:bg-red-700 rounded"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={connectBroadcaster}
              className="text-xs px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded"
            >
              Connect channel
            </button>
          )}
        </div>
        {broadcaster ? (
          <p className="text-sm text-stone-300">
            Linked to{' '}
            <span className="text-purple-400">@{broadcaster.broadcaster_login}</span>{' '}
            ({broadcaster.broadcaster_display_name}). Twitch features (chat
            posts, alerts) will use this channel.
          </p>
        ) : (
          <p className="text-sm text-stone-500">
            No broadcast channel linked. Connect a Twitch account to use chat
            posting and other broadcast-side features. The broadcaster account
            can be different from your GM sign-in.
          </p>
        )}
        {broadcasterFlash && (
          <p className="text-xs text-emerald-400 mt-2">{broadcasterFlash}</p>
        )}
      </section>

      <section className="mb-8 bg-stone-800 border border-stone-700 rounded p-4">
        <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
          <h2 className="text-xl">VTT Bridge</h2>
          {vttToken && (
            <div className="flex gap-1">
              <button
                onClick={() => setTokenVisible((v) => !v)}
                className="text-xs px-3 py-1 bg-stone-700 hover:bg-stone-600 rounded"
              >
                {tokenVisible ? 'Hide token' : 'Show token'}
              </button>
              <button
                onClick={regenerateToken}
                className="text-xs px-3 py-1 bg-stone-700 hover:bg-red-700 rounded"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-stone-500 mb-3">
          Webhook for VTT bridge modules to push initiative and dice rolls in.
          Module developers: see <code className="text-stone-300">docs/vtt-api.md</code> for the payload spec.
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-stone-400 w-20">Endpoint</span>
            <code className="text-xs text-stone-300 bg-stone-900 px-2 py-1 rounded flex-1 truncate">
              {origin}/api/vtt/state
            </code>
            <button
              onClick={() => copy('vtt-url', `${origin}/api/vtt/state`)}
              className="text-xs px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded whitespace-nowrap"
            >
              {copied === 'vtt-url' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-stone-400 w-20">Token</span>
            <code className="text-xs text-stone-300 bg-stone-900 px-2 py-1 rounded flex-1 truncate font-mono">
              {!vttToken
                ? 'Loading…'
                : tokenVisible
                  ? vttToken
                  : '•'.repeat(Math.min(vttToken.length, 48))}
            </code>
            <button
              onClick={() => vttToken && copy('vtt-token', vttToken)}
              disabled={!vttToken}
              className="text-xs px-3 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 rounded whitespace-nowrap"
            >
              {copied === 'vtt-token' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </section>

      <DiceRoller
        lastRoll={campaign.settings?.lastRoll}
        onRoll={(roll) => setSetting('lastRoll', roll)}
        broadcasterLinked={Boolean(broadcaster)}
        campaignId={campaign.id}
      />

      <TwitchPolls
        broadcaster={broadcaster}
        campaignId={campaign.id}
        onReconnect={connectBroadcaster}
      />

      <InitiativeTracker
        combat={campaign.settings?.combat}
        characters={characters}
        onChange={(next) => setSetting('combat', next ?? undefined)}
      />

      <section className="mb-8 bg-stone-800 border border-stone-700 rounded p-4">
        <h2 className="text-xl mb-3">Settings</h2>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4 mt-1"
            checked={Boolean(campaign.settings?.partyViewRespectsHideToggles)}
            onChange={(e) =>
              setSetting('partyViewRespectsHideToggles', e.target.checked)
            }
          />
          <span>
            <span className="block text-stone-200">
              Party view respects per-character hide toggles
            </span>
            <span className="block text-xs text-stone-500 mt-0.5">
              When off (default), players see everyone's full info on the party
              panel. When on, fields a player has hidden from the OBS overlay are
              also hidden from teammates.
            </span>
          </span>
        </label>

        <div className="mt-5 pt-4 border-t border-stone-700">
          <div className="text-stone-200 mb-1">Twitch chat alerts</div>
          <p className="text-xs text-stone-500 mb-3">
            Auto-post events to your linked broadcast channel. This page must be
            open during play for alerts to fire.{' '}
            {!broadcaster && (
              <span className="text-amber-400">
                Connect a broadcast channel above to enable.
              </span>
            )}
          </p>
          <AlertToggle
            label="Round advances"
            description={'Fires on Next/Prev turn — "Round 3 — Aragorn’s turn"'}
            checked={Boolean(campaign.settings?.alerts?.onRoundAdvance)}
            disabled={!broadcaster}
            onChange={(v) =>
              setSetting('alerts', {
                ...(campaign.settings?.alerts ?? {}),
                onRoundAdvance: v,
              })
            }
          />
          <AlertToggle
            label="Below 25% HP (bloodied)"
            description="Fires when a character drops past 25% max HP"
            checked={Boolean(campaign.settings?.alerts?.onLowHp)}
            disabled={!broadcaster}
            onChange={(v) =>
              setSetting('alerts', {
                ...(campaign.settings?.alerts ?? {}),
                onLowHp: v,
              })
            }
          />
          <AlertToggle
            label="Drops to 0 HP"
            description="Fires when a character is downed"
            checked={Boolean(campaign.settings?.alerts?.onZeroHp)}
            disabled={!broadcaster}
            onChange={(v) =>
              setSetting('alerts', {
                ...(campaign.settings?.alerts ?? {}),
                onZeroHp: v,
              })
            }
          />
        </div>
      </section>

      <section>
        <h2 className="text-2xl mb-1">Party ({characters.length})</h2>
        <p className="text-sm text-stone-500 mb-3">
          Drag the handle to reorder. Order matches the overlay preview and the order players appear in.
        </p>
        {characters.length === 0 ? (
          <p className="text-stone-500">No players have joined yet.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={characters.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-3">
                {characters.map((ch) => (
                  <SortableCharacterRow
                    key={ch.id}
                    character={ch}
                    campaignId={campaign.id}
                    origin={origin}
                    copiedKey={copied}
                    onCopy={copy}
                    onRemove={removeCharacter}
                    onBumpHp={bumpHp}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>
    </div>
  );
}

function SortableCharacterRow(props: {
  character: Character;
  campaignId: string;
  origin: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  onRemove: (id: string) => void;
  onBumpHp: (id: string, delta: number, current: number) => void;
}) {
  const ch = props.character;
  const charOverlayUrl = `${props.origin}/overlay/${props.campaignId}/${ch.id}`;
  const editUrl = `/play/${props.campaignId}/${ch.id}`;
  const copyKey = `char:${ch.id}`;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ch.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="bg-stone-800 border border-stone-700 rounded p-4"
    >
      <div className="flex items-start gap-3">
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="text-stone-500 hover:text-stone-300 cursor-grab active:cursor-grabbing px-2 py-1 select-none touch-none"
        >
          ⠿
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xl">{ch.name || '(unnamed)'}</div>
          <div className="text-sm text-stone-400">
            {ch.race || '—'} {ch.class || '—'}
            {ch.twitch_display_name && (
              <span className="ml-2 text-purple-400">
                @{ch.twitch_display_name}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1 flex-wrap">
            <span className="text-xs uppercase tracking-wide text-stone-500 mr-1">
              HP {ch.current_hp}/{ch.max_hp}
            </span>
            <button
              onClick={() => props.onBumpHp(ch.id, -5, ch.current_hp)}
              className="text-xs px-2 py-0.5 bg-stone-900 hover:bg-stone-700 border border-stone-600 rounded"
            >
              −5
            </button>
            <button
              onClick={() => props.onBumpHp(ch.id, -1, ch.current_hp)}
              className="text-xs px-2 py-0.5 bg-stone-900 hover:bg-stone-700 border border-stone-600 rounded"
            >
              −1
            </button>
            <button
              onClick={() => props.onBumpHp(ch.id, +1, ch.current_hp)}
              className="text-xs px-2 py-0.5 bg-stone-900 hover:bg-stone-700 border border-stone-600 rounded"
            >
              +1
            </button>
            <button
              onClick={() => props.onBumpHp(ch.id, +5, ch.current_hp)}
              className="text-xs px-2 py-0.5 bg-stone-900 hover:bg-stone-700 border border-stone-600 rounded"
            >
              +5
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="text-xs text-stone-300 bg-stone-900 px-2 py-1 rounded truncate flex-1">
              {charOverlayUrl}
            </code>
            <button
              onClick={() => props.onCopy(copyKey, charOverlayUrl)}
              className="text-xs px-3 py-1 bg-purple-700 hover:bg-purple-600 rounded whitespace-nowrap"
            >
              {props.copiedKey === copyKey ? 'Copied!' : 'Copy overlay URL'}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <Link
            to={editUrl}
            className="text-sm px-3 py-1 bg-stone-700 hover:bg-stone-600 rounded"
          >
            Edit
          </Link>
          <button
            onClick={() => props.onRemove(ch.id)}
            className="text-sm text-red-400 hover:text-red-300 px-1"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

function DiceRoller(props: {
  lastRoll: DiceRoll | undefined;
  onRoll: (roll: DiceRoll) => void;
  broadcasterLinked: boolean;
  campaignId: string;
}) {
  const POST_TO_CHAT_KEY = `rollcall.postToChat.${props.campaignId}`;
  const [expr, setExpr] = useState('1d20');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [postToChat, setPostToChat] = useState(() => {
    try {
      return localStorage.getItem(POST_TO_CHAT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [posting, setPosting] = useState(false);

  const setPostToChatPersisted = (v: boolean) => {
    setPostToChat(v);
    try {
      if (v) localStorage.setItem(POST_TO_CHAT_KEY, '1');
      else localStorage.removeItem(POST_TO_CHAT_KEY);
    } catch {
      /* ignore */
    }
  };

  const roll = async () => {
    const result = rollDice(expr);
    if (!result) {
      setError('Try formats like 1d20, 2d6+3, 1d8-1');
      return;
    }
    setError(null);
    const labelTrim = label.trim() || undefined;
    props.onRoll({ ...result, label: labelTrim });

    if (postToChat && props.broadcasterLinked) {
      setPosting(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('Not signed in');
        const message = labelTrim
          ? `🎲 ${labelTrim}: ${result.expression} = ${result.total} ${result.detail}`
          : `🎲 ${result.expression} = ${result.total} ${result.detail}`;
        const r = await fetch('/api/twitch/post-chat', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ campaignId: props.campaignId, message }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          setError(`Chat post failed: ${err.error ?? r.statusText}`);
        }
      } catch (e) {
        setError(`Chat post failed: ${(e as Error).message}`);
      } finally {
        setPosting(false);
      }
    }
  };

  return (
    <section className="mb-8 bg-stone-800 border border-stone-700 rounded p-4">
      <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <h2 className="text-xl">Dice</h2>
        {props.lastRoll && (
          <span className="text-sm text-stone-400">
            Last:{' '}
            <span className="text-stone-200">
              {props.lastRoll.label && `${props.lastRoll.label} — `}
              {props.lastRoll.expression} → <strong>{props.lastRoll.total}</strong>
            </span>
          </span>
        )}
      </div>
      <div className="flex gap-1 flex-wrap items-center">
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && roll()}
          placeholder="1d20+5"
          className="bg-stone-900 px-2 py-1 rounded border border-stone-600 text-sm w-28 font-mono"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && roll()}
          placeholder="Label (optional)"
          className="bg-stone-900 px-2 py-1 rounded border border-stone-600 text-sm flex-1 min-w-[120px]"
        />
        <button
          onClick={roll}
          disabled={posting}
          className="text-sm px-3 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 rounded"
        >
          {posting ? 'Posting…' : 'Roll'}
        </button>
      </div>
      <label
        className={
          'flex items-center gap-2 mt-2 text-xs select-none ' +
          (props.broadcasterLinked ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')
        }
      >
        <input
          type="checkbox"
          checked={postToChat && props.broadcasterLinked}
          disabled={!props.broadcasterLinked}
          onChange={(e) => setPostToChatPersisted(e.target.checked)}
          className="w-3.5 h-3.5"
        />
        <span className="text-stone-300">
          Also post to Twitch chat
          {!props.broadcasterLinked && (
            <span className="text-stone-500"> — connect a broadcast channel first</span>
          )}
        </span>
      </label>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <p className="text-xs text-stone-500 mt-2">
        Result broadcasts to the OBS overlay as a brief toast. Format: NdM, NdM+K, NdM-K.
      </p>
    </section>
  );
}

function TwitchPolls(props: {
  broadcaster: {
    broadcaster_login: string;
    broadcaster_display_name: string;
    scopes: string[];
  } | null;
  campaignId: string;
  onReconnect: () => void;
}) {
  const POLLS_SCOPE = 'channel:manage:polls';
  const DURATIONS = [15, 30, 60, 120, 300];
  const [title, setTitle] = useState('');
  const [choices, setChoices] = useState<string[]>(['', '']);
  const [duration, setDuration] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activePoll, setActivePoll] = useState<{
    title: string;
    endsAt: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while a poll is active so the countdown updates.
  useEffect(() => {
    if (!activePoll) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [activePoll]);

  // Auto-clear the active poll banner after the duration elapses.
  useEffect(() => {
    if (!activePoll) return;
    if (now >= activePoll.endsAt) setActivePoll(null);
  }, [activePoll, now]);

  if (!props.broadcaster) return null;

  const hasScope = props.broadcaster.scopes?.includes(POLLS_SCOPE);

  const setChoice = (i: number, v: string) =>
    setChoices((cs) => cs.map((c, idx) => (idx === i ? v : c)));

  const addChoice = () =>
    setChoices((cs) => (cs.length < 5 ? [...cs, ''] : cs));

  const removeChoice = (i: number) =>
    setChoices((cs) => (cs.length > 2 ? cs.filter((_, idx) => idx !== i) : cs));

  const startPoll = async () => {
    setError(null);
    const trimmedTitle = title.trim();
    const trimmedChoices = choices.map((c) => c.trim()).filter(Boolean);
    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }
    if (trimmedChoices.length < 2) {
      setError('Need at least 2 non-empty choices');
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch('/api/twitch/start-poll', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          campaignId: props.campaignId,
          title: trimmedTitle,
          choices: trimmedChoices,
          durationSeconds: duration,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setError(err.error ?? r.statusText);
        return;
      }
      const data = (await r.json()) as { title: string; ends_at: string };
      setActivePoll({
        title: data.title,
        endsAt: new Date(data.ends_at).getTime(),
      });
      // Reset form for the next poll.
      setTitle('');
      setChoices(['', '']);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mb-8 bg-stone-800 border border-stone-700 rounded p-4">
      <h2 className="text-xl mb-3">Polls</h2>

      {!hasScope ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-300">
            Polls need the <code>channel:manage:polls</code> permission, which
            the linked broadcast channel hasn't granted yet. Reconnect the
            channel to grant it.
          </p>
          <button
            onClick={props.onReconnect}
            className="text-sm px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded"
          >
            Reconnect broadcast channel
          </button>
        </div>
      ) : activePoll && now < activePoll.endsAt ? (
        <div className="space-y-2">
          <div className="text-sm text-emerald-400">
            Poll active: <strong>{activePoll.title}</strong>
          </div>
          <div className="text-xs text-stone-400">
            Ends in {Math.max(0, Math.ceil((activePoll.endsAt - now) / 1000))}s.
            Voters use Twitch's native poll UI in the player.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Question"
            maxLength={60}
            className="w-full bg-stone-900 px-3 py-2 rounded border border-stone-600 text-sm"
          />
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-stone-500 w-4">{i + 1}.</span>
              <input
                value={c}
                onChange={(e) => setChoice(i, e.target.value)}
                placeholder={`Choice ${i + 1}`}
                maxLength={25}
                className="flex-1 bg-stone-900 px-2 py-1 rounded border border-stone-600 text-sm"
              />
              {choices.length > 2 && (
                <button
                  onClick={() => removeChoice(i)}
                  aria-label="Remove choice"
                  className="text-xs text-stone-500 hover:text-red-400 px-1"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {choices.length < 5 && (
              <button
                onClick={addChoice}
                className="text-xs px-2 py-1 bg-stone-900 hover:bg-stone-700 border border-stone-600 rounded"
              >
                + Add choice
              </button>
            )}
            <label className="flex items-center gap-1 text-xs text-stone-400 ml-auto">
              <span>Duration</span>
              <select
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                className="bg-stone-900 px-2 py-1 rounded border border-stone-600 text-stone-200"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={startPoll}
              disabled={submitting}
              className="text-sm px-4 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 rounded"
            >
              {submitting ? 'Starting…' : 'Start poll'}
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </section>
  );
}

function InitiativeTracker(props: {
  combat: CombatState | undefined;
  characters: Character[];
  onChange: (next: CombatState | null) => void;
}) {
  const { combat, characters, onChange } = props;
  const [npcName, setNpcName] = useState('');
  const [npcInit, setNpcInit] = useState<string>('10');

  const setCombat = (cb: (s: CombatState) => CombatState) => {
    if (!combat) return;
    onChange(cb(combat));
  };

  const startCombat = () => {
    onChange({ active: true, round: 1, activeIndex: 0, combatants: [] });
  };

  const endCombat = () => {
    if (!confirm('End combat and clear initiative?')) return;
    onChange(null);
  };

  const addPlayer = (ch: Character) => {
    setCombat((s) => {
      if (s.combatants.some((cm) => cm.characterId === ch.id)) return s;
      const combatants = sortByInitiative([
        ...s.combatants,
        {
          id: crypto.randomUUID(),
          characterId: ch.id,
          name: ch.name || '(unnamed)',
          initiative: 10,
        },
      ]);
      return { ...s, combatants };
    });
  };

  const addNpc = () => {
    const name = npcName.trim();
    const init = parseInt(npcInit, 10);
    if (!name || Number.isNaN(init)) return;
    setCombat((s) => {
      const combatants = sortByInitiative([
        ...s.combatants,
        { id: crypto.randomUUID(), characterId: null, name, initiative: init },
      ]);
      return { ...s, combatants };
    });
    setNpcName('');
    setNpcInit('10');
  };

  const updateInit = (id: string, init: number) => {
    setCombat((s) => {
      const updated = s.combatants.map((c) => (c.id === id ? { ...c, initiative: init } : c));
      const sorted = sortByInitiative(updated);
      const oldActive = s.combatants[s.activeIndex];
      const newActive = oldActive ? sorted.findIndex((c) => c.id === oldActive.id) : 0;
      return { ...s, combatants: sorted, activeIndex: Math.max(0, newActive) };
    });
  };

  const updateName = (id: string, name: string) => {
    setCombat((s) => ({
      ...s,
      combatants: s.combatants.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  };

  const removeCombatant = (id: string) => {
    setCombat((s) => {
      const idx = s.combatants.findIndex((c) => c.id === id);
      const combatants = s.combatants.filter((c) => c.id !== id);
      let activeIndex = s.activeIndex;
      if (combatants.length === 0) activeIndex = 0;
      else if (idx < s.activeIndex) activeIndex = Math.max(0, s.activeIndex - 1);
      else if (idx === s.activeIndex && activeIndex >= combatants.length) activeIndex = 0;
      return { ...s, combatants, activeIndex };
    });
  };

  const next = () => setCombat(advanceTurn);
  const prev = () => setCombat(previousTurn);

  if (!combat?.active) {
    return (
      <section className="mb-8 bg-stone-800 border border-stone-700 rounded p-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl">Initiative</h2>
          <button
            onClick={startCombat}
            className="text-sm px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded"
          >
            Start combat
          </button>
        </div>
        <p className="text-xs text-stone-500 mt-2">
          Manual initiative for now — VTT-bridge modules (Fantasy Grounds, Foundry,
          etc.) will populate this automatically in a future release.
        </p>
      </section>
    );
  }

  const addedCharacterIds = new Set(combat.combatants.map((c) => c.characterId).filter(Boolean));
  const addablePlayers = characters.filter((c) => !addedCharacterIds.has(c.id));
  const active = combat.combatants[combat.activeIndex];

  return (
    <section className="mb-8 bg-stone-800 border border-stone-700 rounded p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl">
          Initiative — Round {combat.round}
          {active && <span className="text-purple-400"> · {active.name}'s turn</span>}
        </h2>
        <div className="flex gap-1">
          <button
            onClick={prev}
            disabled={combat.combatants.length === 0}
            className="text-sm px-3 py-1.5 bg-stone-700 hover:bg-stone-600 disabled:opacity-40 rounded"
          >
            ← Prev
          </button>
          <button
            onClick={next}
            disabled={combat.combatants.length === 0}
            className="text-sm px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 rounded"
          >
            Next turn →
          </button>
          <button
            onClick={endCombat}
            className="text-sm px-3 py-1.5 bg-stone-700 hover:bg-red-700 rounded ml-2"
          >
            End combat
          </button>
        </div>
      </div>

      {combat.combatants.length === 0 ? (
        <p className="text-sm text-stone-500 mb-3">No combatants yet — add some below.</p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {combat.combatants.map((cm, i) => (
            <CombatantRow
              key={cm.id}
              combatant={cm}
              isActive={i === combat.activeIndex}
              isPC={Boolean(cm.characterId)}
              onInitChange={(v) => updateInit(cm.id, v)}
              onNameChange={(v) => updateName(cm.id, v)}
              onRemove={() => removeCombatant(cm.id)}
            />
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className="text-xs uppercase tracking-wide text-stone-400 mb-1 block">
            Add player
          </span>
          {addablePlayers.length === 0 ? (
            <p className="text-sm text-stone-500">All players added.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {addablePlayers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => addPlayer(c)}
                  className="text-sm px-3 py-1 bg-stone-900 border border-stone-600 hover:border-stone-400 rounded"
                >
                  + {c.name || '(unnamed)'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <span className="text-xs uppercase tracking-wide text-stone-400 mb-1 block">
            Add NPC / monster
          </span>
          <div className="flex gap-1">
            <input
              value={npcName}
              onChange={(e) => setNpcName(e.target.value)}
              placeholder="Name"
              className="bg-stone-900 px-2 py-1 rounded border border-stone-600 text-sm flex-1"
            />
            <input
              type="number"
              value={npcInit}
              onChange={(e) => setNpcInit(e.target.value)}
              className="bg-stone-900 px-2 py-1 rounded border border-stone-600 text-sm w-16 text-center"
            />
            <button
              onClick={addNpc}
              disabled={!npcName.trim()}
              className="text-sm px-3 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 rounded"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CombatantRow(props: {
  combatant: Combatant;
  isActive: boolean;
  isPC: boolean;
  onInitChange: (v: number) => void;
  onNameChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { combatant: cm, isActive, isPC } = props;
  return (
    <li
      className={
        'flex items-center gap-2 px-3 py-2 rounded border ' +
        (isActive
          ? 'bg-purple-900/40 border-purple-600'
          : 'bg-stone-900 border-stone-700')
      }
    >
      <span className="text-stone-400 w-4 text-center">{isActive ? '▶' : ' '}</span>
      <input
        type="number"
        value={cm.initiative}
        onChange={(e) => props.onInitChange(parseInt(e.target.value || '0', 10))}
        className="bg-stone-950 border border-stone-700 rounded px-2 py-0.5 text-sm w-14 text-center"
      />
      {isPC ? (
        <span className="flex-1 text-stone-200">{cm.name}</span>
      ) : (
        <input
          value={cm.name}
          onChange={(e) => props.onNameChange(e.target.value)}
          className="bg-stone-950 border border-stone-700 rounded px-2 py-0.5 text-sm flex-1"
        />
      )}
      {isPC ? (
        <span className="text-xs text-purple-400 px-1">PC</span>
      ) : (
        <span className="text-xs text-stone-500 px-1">NPC</span>
      )}
      <button
        onClick={props.onRemove}
        className="text-xs text-stone-500 hover:text-red-400"
      >
        Remove
      </button>
    </li>
  );
}

function AlertToggle(props: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={
        'flex items-start gap-3 py-1 select-none ' +
        (props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')
      }
    >
      <input
        type="checkbox"
        className="w-4 h-4 mt-1"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>
        <span className="block text-stone-200 text-sm">{props.label}</span>
        <span className="block text-xs text-stone-500 mt-0.5">{props.description}</span>
      </span>
    </label>
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
        <span className="text-sm uppercase tracking-wide text-stone-400">
          {props.label}
        </span>
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
