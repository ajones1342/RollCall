import { useEffect, useState } from 'react';
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
import type { Campaign, Character } from '../lib/types';

export default function CampaignManage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

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

  if (loading || !campaign) return <div className="p-8">Loading…</div>;

  const origin = window.location.origin;
  const joinUrl = `${origin}/join/${campaign.id}`;
  const overlayUrl = `${origin}/overlay/${campaign.id}`;

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
