import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  DEFAULT_THEME,
  alignToFlex,
  anchorCss,
  fillStyle,
  mergeTheme,
  normalizeHiddenFields,
  type Character,
  type Theme,
} from '../lib/types';

function cardFilter(strength: number): string {
  const a = 0.9 * strength;
  const b = 0.85 * strength;
  return `drop-shadow(0 4px 8px rgba(0,0,0,${a})) drop-shadow(0 0 4px rgba(0,0,0,${b}))`;
}

export default function Overlay() {
  const { campaignId, characterId } = useParams<{
    campaignId: string;
    characterId?: string;
  }>();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    document.body.classList.add('overlay-mode');
    return () => document.body.classList.remove('overlay-mode');
  }, []);

  useEffect(() => {
    if (!campaignId) return;

    const refreshCharacters = async () => {
      const query = supabase.from('characters').select('*').eq('campaign_id', campaignId);
      if (characterId) query.eq('id', characterId);
      const { data } = await query.order('display_order', { ascending: true });
      setCharacters((data as Character[]) ?? []);
    };

    const refreshTheme = async () => {
      const { data } = await supabase
        .from('campaigns')
        .select('theme')
        .eq('id', campaignId)
        .maybeSingle();
      setTheme(mergeTheme((data as { theme: Partial<Theme> } | null)?.theme));
    };

    refreshCharacters();
    refreshTheme();

    const charFilter = characterId
      ? `id=eq.${characterId}`
      : `campaign_id=eq.${campaignId}`;

    const channel = supabase
      .channel(`overlay:${campaignId}:${characterId ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'characters', filter: charFilter },
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
        () => refreshTheme()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, characterId]);

  if (characterId) {
    const c = characters[0];
    if (!c) return null;
    return (
      <ScaleToFit>
        <CharacterCard1080 c={c} theme={theme} />
      </ScaleToFit>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        padding: 24,
        minHeight: '100vh',
      }}
    >
      {characters.map((c) => (
        <div
          key={c.id}
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            position: 'relative',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <ScaleToFit>
            <CharacterCard1080 c={c} theme={theme} />
          </ScaleToFit>
        </div>
      ))}
    </div>
  );
}

export function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [size, setSize] = useState({ w: 1920, h: 1080 });

  useEffect(() => {
    const update = () => {
      setSize({ w: window.innerWidth, h: window.innerHeight });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return <ScaleToFitInner parentSize={size}>{children}</ScaleToFitInner>;
}

function ScaleToFitInner({
  children,
  parentSize,
}: {
  children: React.ReactNode;
  parentSize: { w: number; h: number };
}) {
  const [scale, setScale] = useState(1);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!wrapperEl) return;
    const update = () => {
      const rect = wrapperEl.getBoundingClientRect();
      const sx = rect.width / 1920;
      const sy = rect.height / 1080;
      setScale(Math.min(sx, sy));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapperEl);
    return () => ro.disconnect();
  }, [wrapperEl, parentSize]);

  return (
    <div
      ref={setWrapperEl}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: 1920,
          height: 1080,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          flex: '0 0 auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DeathSavesIndicator({
  successes,
  failures,
}: {
  successes: number;
  failures: number;
}) {
  const dot = (filled: boolean, color: string) => (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: filled ? color : 'transparent',
        border: filled ? 'none' : `4px solid ${color}`,
        boxSizing: 'border-box',
      }}
    />
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        {[1, 2, 3].map((n) => (
          <div key={`s${n}`}>{dot(successes >= n, '#10b981')}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {[1, 2, 3].map((n) => (
          <div key={`f${n}`}>{dot(failures >= n, '#ef4444')}</div>
        ))}
      </div>
    </div>
  );
}

export type DraggableElement = 'name' | 'attributes' | 'hp' | 'streamer';

export function CharacterCard1080({
  c,
  theme,
  editable,
  onPositionChange,
}: {
  c: Character;
  theme: Theme;
  editable?: boolean;
  onPositionChange?: (element: DraggableElement, x: number, y: number) => void;
}) {
  const fill = fillStyle(theme);
  const pos = theme.positions;
  const sz = theme.fontSizes;
  const cardRef = useRef<HTMLDivElement>(null);

  const startDrag = (e: React.MouseEvent, element: DraggableElement) => {
    if (!editable || !onPositionChange || !cardRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = cardRef.current.getBoundingClientRect();
    const scale = rect.width / 1920;
    const startX =
      element === 'name'
        ? pos.nameX
        : element === 'attributes'
          ? pos.attributesX
          : element === 'hp'
            ? pos.hpX
            : pos.streamerX;
    const startY =
      element === 'name'
        ? pos.nameY
        : element === 'attributes'
          ? pos.attributesY
          : element === 'hp'
            ? pos.hpY
            : pos.streamerY;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startMouseX) / scale;
      const dy = -(ev.clientY - startMouseY) / scale; // screen-down is positive; design-up is positive
      onPositionChange(element, Math.round(startX + dx), Math.round(startY + dy));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const dragStyle: React.CSSProperties = editable ? { cursor: 'grab' } : {};
  const hidden = new Set(normalizeHiddenFields(c.hidden_fields));
  const showName = !hidden.has('name');
  const showRace = !hidden.has('race') && Boolean(c.race);
  const showClass = !hidden.has('class') && Boolean(c.class);
  const subtitleParts = [showRace ? c.race : null, showClass ? c.class : null].filter(
    (p): p is string => Boolean(p)
  );
  const subtitle = subtitleParts.join(' · ');
  const showSubtitle = subtitle.length > 0;
  const conditions = (c.conditions ?? []).filter(Boolean);
  const showConditions = !hidden.has('conditions') && conditions.length > 0;
  const showTopLeft = showName || showSubtitle || showConditions;
  const showInspiration = !hidden.has('inspiration') && Boolean(c.inspiration);
  const showHp = !hidden.has('hp');
  const tempHp = c.temp_hp ?? 0;
  const showDeathSaves = showHp && c.current_hp === 0;
  const showAttributes = !hidden.has('attributes');
  const showStreamer = !hidden.has('streamer_name') && c.twitch_display_name;

  return (
    <div
      ref={cardRef}
      style={{
        position: 'relative',
        width: 1920,
        height: 1080,
        fontFamily: `'${theme.fontFamily}', serif`,
        filter: cardFilter(theme.shadowStrength),
      }}
    >
      {editable && (
        <style>{`
          .rc-drag { cursor: grab; }
          .rc-drag:hover { outline: 3px dashed rgba(255,255,255,0.35); outline-offset: 12px; }
          .rc-drag:active { cursor: grabbing; }
        `}</style>
      )}
      {/* Name block — anchored corner of block at (nameX, nameY) bottom-left coords. */}
      {showTopLeft && (
        <div
          className={editable ? 'rc-drag' : undefined}
          onMouseDown={editable ? (e) => startDrag(e, 'name') : undefined}
          style={{
            ...anchorCss(pos.nameAnchor, pos.nameX, pos.nameY),
            whiteSpace: 'nowrap',
            textAlign: pos.nameAlign,
            ...dragStyle,
          }}
        >
          {showName && (
            <div
              style={{
                ...fill,
                fontSize: sz.name,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '0.04em',
              }}
            >
              {showInspiration && <span style={{ marginRight: 18 }}>★</span>}
              {c.name || '—'}
            </div>
          )}
          {showSubtitle && (
            <div
              style={{
                ...fill,
                fontSize: sz.subtitle,
                marginTop: showName ? 18 : 0,
                letterSpacing: '0.1em',
                opacity: 0.92,
              }}
            >
              {subtitle}
            </div>
          )}
          {showConditions && (
            <div
              style={{
                ...fill,
                fontSize: sz.conditions,
                marginTop: 14,
                letterSpacing: '0.1em',
                opacity: 0.85,
                fontStyle: 'italic',
              }}
            >
              {conditions.map((cond) => cond.toLowerCase()).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Attributes column — anchored corner of column at (attributesX, attributesY).
          Rows stack with attributesRowGap; row alignment within column follows attributesAlign. */}
      {showAttributes && (
        <div
          className={editable ? 'rc-drag' : undefined}
          onMouseDown={editable ? (e) => startDrag(e, 'attributes') : undefined}
          style={{
            ...anchorCss(pos.attributesAnchor, pos.attributesX, pos.attributesY),
            display: 'flex',
            flexDirection: 'column',
            gap: pos.attributesRowGap,
            alignItems: alignToFlex(pos.attributesAlign),
            ...dragStyle,
          }}
        >
          {ATTRIBUTE_KEYS.map((k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
              <span
                style={{
                  ...fill,
                  fontSize: sz.attributeLabel,
                  opacity: 0.85,
                  letterSpacing: '0.12em',
                }}
              >
                {ATTRIBUTE_LABELS[k]}
              </span>
              <span
                style={{
                  ...fill,
                  fontSize: sz.attributeValue,
                  fontWeight: 700,
                  minWidth: 130,
                  textAlign: 'right',
                  lineHeight: 1,
                }}
              >
                {c[k]}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* HP block — anchored corner of block at (hpX, hpY). Inner row + death-saves
          aligned per hpAlign. */}
      {showHp && (
        <div
          className={editable ? 'rc-drag' : undefined}
          onMouseDown={editable ? (e) => startDrag(e, 'hp') : undefined}
          style={{
            ...anchorCss(pos.hpAnchor, pos.hpX, pos.hpY),
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            alignItems: alignToFlex(pos.hpAlign),
            ...dragStyle,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <span
              style={{
                ...fill,
                fontSize: sz.hpLabel,
                opacity: 0.85,
                letterSpacing: '0.12em',
              }}
            >
              HP
            </span>
            <span
              style={{
                ...fill,
                fontSize: sz.hpValue,
                fontWeight: 700,
                letterSpacing: '0.04em',
                lineHeight: 1,
              }}
            >
              {c.current_hp} / {c.max_hp}
            </span>
            {tempHp > 0 && (
              <span
                style={{
                  ...fill,
                  fontSize: sz.hpLabel,
                  opacity: 0.85,
                  letterSpacing: '0.04em',
                }}
              >
                +{tempHp}
              </span>
            )}
          </div>
          {showDeathSaves && (
            <DeathSavesIndicator
              successes={c.death_save_successes ?? 0}
              failures={c.death_save_failures ?? 0}
            />
          )}
        </div>
      )}

      {/* Streamer container — anchored corner at (streamerX, streamerY).
          streamerWidth defines extent; text aligns inside per streamerAlign. */}
      {showStreamer && (
        <div
          className={editable ? 'rc-drag' : undefined}
          onMouseDown={editable ? (e) => startDrag(e, 'streamer') : undefined}
          style={{
            ...anchorCss(pos.streamerAnchor, pos.streamerX, pos.streamerY),
            width: pos.streamerWidth,
            textAlign: pos.streamerAlign,
            ...dragStyle,
          }}
        >
          <span
            style={{
              ...fill,
              fontSize: sz.streamerName,
              letterSpacing: '0.12em',
              opacity: 0.92,
              whiteSpace: 'nowrap',
            }}
          >
            {c.twitch_display_name}
          </span>
        </div>
      )}
    </div>
  );
}

