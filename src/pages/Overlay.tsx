import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  DEFAULT_THEME,
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

export function CharacterCard1080({ c, theme }: { c: Character; theme: Theme }) {
  const fill = fillStyle(theme);
  const pos = theme.positions;
  const sz = theme.fontSizes;
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
      style={{
        position: 'relative',
        width: 1920,
        height: 1080,
        fontFamily: `'${theme.fontFamily}', serif`,
        filter: cardFilter(theme.shadowStrength),
      }}
    >
      {/* Name block — anchor: top-left of block at (nameX, nameY) bottom-left coords. */}
      {showTopLeft && (
        <div
          style={{
            position: 'absolute',
            top: 1080 - pos.nameY,
            left: pos.nameX,
            maxWidth: 1920 - pos.nameX - 200,
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

      {/* Attributes column — anchor: top-right of column at (attributesX, attributesY)
          bottom-left coords. Stacks down/left from anchor with attributesRowGap between rows. */}
      {showAttributes && (
        <div
          style={{
            position: 'absolute',
            top: 1080 - pos.attributesY,
            right: 1920 - pos.attributesX,
            display: 'flex',
            flexDirection: 'column',
            gap: pos.attributesRowGap,
            alignItems: 'flex-end',
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

      {/* HP block — anchor: bottom-left of block at (hpX, hpY) bottom-left coords. */}
      {showHp && (
        <div
          style={{
            position: 'absolute',
            bottom: pos.hpY,
            left: pos.hpX,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
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

      {/* Streamer container — anchor: bottom-left at (streamerX, streamerY) bottom-left coords.
          streamerWidth defines the horizontal extent; text is centered inside the container. */}
      {showStreamer && (
        <div
          style={{
            position: 'absolute',
            bottom: pos.streamerY,
            left: pos.streamerX,
            width: pos.streamerWidth,
            textAlign: 'center',
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

