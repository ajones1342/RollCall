// Combat tracker overlay — a separate OBS browser source that renders the
// initiative order on stream so viewers can see whose turn it is, the round
// counter, and live HP / inspiration / conditions for each PC.
//
// Reads the same theme as the per-character overlay (font, fill, shadow,
// canvas dimensions) so styling matches across all of a campaign's overlays.
//
// Route: /overlay/:campaignId/combat

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_THEME,
  anchorCss,
  fillStyle,
  mergeTheme,
  type CampaignSettings,
  type Character,
  type CombatState,
  type Theme,
} from '../lib/types';
import { ScaleToFit } from './Overlay';

export default function CombatOverlay() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [combat, setCombat] = useState<CombatState | undefined>(undefined);
  const [characters, setCharacters] = useState<Character[]>([]);

  useEffect(() => {
    document.body.classList.add('overlay-mode');
    return () => document.body.classList.remove('overlay-mode');
  }, []);

  useEffect(() => {
    if (!campaignId) return;

    const refreshCampaign = () =>
      supabase
        .from('campaigns')
        .select('theme, settings')
        .eq('id', campaignId)
        .maybeSingle()
        .then(({ data }) => {
          const row = data as
            | { theme: Partial<Theme> | null; settings: CampaignSettings | null }
            | null;
          setTheme(mergeTheme(row?.theme));
          setCombat(row?.settings?.combat);
        });

    const refreshCharacters = () =>
      supabase
        .from('characters')
        .select('*')
        .eq('campaign_id', campaignId)
        .then(({ data }) => setCharacters((data as Character[]) ?? []));

    refreshCampaign();
    refreshCharacters();

    const channel = supabase
      .channel(`combat-overlay:${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'characters',
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => refreshCharacters()
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

  return (
    <ScaleToFit
      canvasWidth={theme.combatCanvasWidth}
      canvasHeight={theme.combatCanvasHeight}
    >
      <CombatTrackerCanvas theme={theme} combat={combat} characters={characters} />
    </ScaleToFit>
  );
}

export function CombatTrackerCanvas({
  theme,
  combat,
  characters,
  forceVisible = false,
}: {
  theme: Theme;
  combat: CombatState | undefined;
  characters: Character[];
  forceVisible?: boolean;
}) {
  const fill = fillStyle(theme);
  const sz = theme.fontSizes;
  const pos = theme.positions;
  const charById = new Map(characters.map((c) => [c.id, c]));

  // Don't render anything when no combat is active — keeps the OBS source
  // invisible during downtime. Editor preview overrides via forceVisible.
  if (!forceVisible && !combat?.active) return null;
  if (!combat) return null;

  const cardFilter =
    `drop-shadow(0 4px 8px rgba(0,0,0,${0.9 * theme.shadowStrength})) ` +
    `drop-shadow(0 0 4px rgba(0,0,0,${0.85 * theme.shadowStrength}))`;

  // The container anchors per theme.positions.trackerAnchor at (trackerX,
  // trackerY) bottom-left coords. Width is fixed; height grows with content.
  return (
    <div
      style={{
        ...anchorCss(
          pos.trackerAnchor,
          pos.trackerX,
          pos.trackerY,
          theme.combatCanvasWidth,
          theme.combatCanvasHeight
        ),
        width: pos.trackerWidth,
        fontFamily: `'${theme.fontFamily}', serif`,
        filter: cardFilter,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div
        style={{
          ...fill,
          fontSize: Math.max(48, sz.name * 0.55),
          fontWeight: 700,
          letterSpacing: '0.12em',
          lineHeight: 1,
        }}
      >
        ROUND {combat.round}
      </div>

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: pos.trackerRowGap }}
      >
        {combat.combatants.map((cm, i) => {
          const isActive = i === combat.activeIndex;
          const ch = cm.characterId ? charById.get(cm.characterId) : null;
          return (
            <CombatRow
              key={cm.id}
              active={isActive}
              initiative={cm.initiative}
              name={cm.name}
              character={ch ?? null}
              fill={fill}
              theme={theme}
            />
          );
        })}
      </div>
    </div>
  );
}

function CombatRow({
  active,
  initiative,
  name,
  character,
  fill,
  theme,
}: {
  active: boolean;
  initiative: number;
  name: string;
  character: Character | null;
  fill: React.CSSProperties;
  theme: Theme;
}) {
  const sz = theme.fontSizes;
  const hp = character ? `${character.current_hp}/${character.max_hp}` : null;
  const tempHp = character?.temp_hp ?? 0;
  const inspiration = character?.inspiration ?? false;
  const conditions = (character?.conditions ?? []).filter(Boolean);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 24,
        padding: '14px 20px',
        borderRadius: 12,
        // Active row: subtle purple wash + brighter outline
        background: active ? 'rgba(168, 85, 247, 0.18)' : 'transparent',
        outline: active ? '2px solid rgba(168, 85, 247, 0.85)' : 'none',
        outlineOffset: 2,
      }}
    >
      <span
        style={{
          ...fill,
          fontSize: Math.round(sz.attributeLabel * 0.9),
          width: 36,
          textAlign: 'center',
          opacity: active ? 1 : 0.5,
        }}
      >
        {active ? '▶' : ''}
      </span>
      <span
        style={{
          ...fill,
          fontSize: Math.round(sz.attributeValue * 0.7),
          fontWeight: 700,
          minWidth: 80,
          textAlign: 'right',
          letterSpacing: '0.04em',
        }}
      >
        {initiative}
      </span>
      <span
        style={{
          ...fill,
          fontSize: Math.round(sz.name * 0.5),
          fontWeight: 600,
          letterSpacing: '0.04em',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {inspiration && <span style={{ marginRight: 12 }}>★</span>}
        {name || '—'}
      </span>
      {hp && (
        <span
          style={{
            ...fill,
            fontSize: Math.round(sz.hpValue * 0.55),
            fontWeight: 700,
            letterSpacing: '0.04em',
            fontVariantNumeric: 'tabular-nums',
            opacity: 0.9,
          }}
        >
          {hp}
          {tempHp > 0 && (
            <span style={{ fontSize: Math.round(sz.hpLabel * 0.7), marginLeft: 8 }}>
              +{tempHp}
            </span>
          )}
        </span>
      )}
      {conditions.length > 0 && (
        <span
          style={{
            ...fill,
            fontSize: Math.round(sz.conditions * 0.8),
            fontStyle: 'italic',
            opacity: 0.85,
            maxWidth: 360,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {conditions.map((c) => c.toLowerCase()).join(', ')}
        </span>
      )}
    </div>
  );
}
