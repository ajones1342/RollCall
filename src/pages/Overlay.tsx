import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, type Character } from '../lib/types';

const TEXT_SHADOW =
  '0 4px 12px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9), 0 2px 0 rgba(0,0,0,0.9)';

export default function Overlay() {
  const { campaignId, characterId } = useParams<{
    campaignId: string;
    characterId?: string;
  }>();
  const [characters, setCharacters] = useState<Character[]>([]);

  useEffect(() => {
    document.body.classList.add('overlay-mode');
    return () => document.body.classList.remove('overlay-mode');
  }, []);

  useEffect(() => {
    if (!campaignId) return;

    const refresh = async () => {
      const query = supabase.from('characters').select('*').eq('campaign_id', campaignId);
      if (characterId) query.eq('id', characterId);
      const { data } = await query.order('display_order', { ascending: true });
      setCharacters((data as Character[]) ?? []);
    };

    refresh();

    const filter = characterId
      ? `id=eq.${characterId}`
      : `campaign_id=eq.${campaignId}`;

    const channel = supabase
      .channel(`overlay:${campaignId}:${characterId ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'characters', filter },
        () => refresh()
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
        <CharacterCard1080 c={c} />
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
            <CharacterCard1080 c={c} />
          </ScaleToFit>
        </div>
      ))}
    </div>
  );
}

function ScaleToFit({ children }: { children: React.ReactNode }) {
  const [size, setSize] = useState({ w: 1920, h: 1080 });

  useEffect(() => {
    const update = () => {
      // For nested containers, ScaleToFit sizes to its parent.
      // In overlay mode the parent is the viewport.
      setSize({ w: window.innerWidth, h: window.innerHeight });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // When rendered inside an aspect-locked parent (multi-mode preview), use
  // ResizeObserver against the wrapper.
  return (
    <ScaleToFitInner parentSize={size}>{children}</ScaleToFitInner>
  );
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

function CharacterCard1080({ c }: { c: Character }) {
  const subtitle = [c.race, c.class].filter(Boolean).join(' · ');

  return (
    <div
      style={{
        position: 'relative',
        width: 1920,
        height: 1080,
        color: '#f5f5f4',
        fontFamily: "'Cinzel', serif",
        textShadow: TEXT_SHADOW,
      }}
    >
      {/* Top-left: name + race/class */}
      <div style={{ position: 'absolute', top: 80, left: 100, maxWidth: 1100 }}>
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '0.04em',
          }}
        >
          {c.name || '—'}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 48,
              marginTop: 18,
              letterSpacing: '0.1em',
              opacity: 0.92,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      {/* Right edge: attributes spread top-to-bottom */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          bottom: 80,
          right: 80,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
        }}
      >
        {ATTRIBUTE_KEYS.map((k) => (
          <div
            key={k}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 24,
            }}
          >
            <span
              style={{
                fontSize: 44,
                opacity: 0.85,
                letterSpacing: '0.12em',
              }}
            >
              {ATTRIBUTE_LABELS[k]}
            </span>
            <span
              style={{
                fontSize: 80,
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

      {/* Bottom-left: HP / Max HP */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 100,
          display: 'flex',
          alignItems: 'baseline',
          gap: 18,
        }}
      >
        <span
          style={{
            fontSize: 44,
            opacity: 0.85,
            letterSpacing: '0.12em',
          }}
        >
          HP
        </span>
        <span
          style={{
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: '0.04em',
            lineHeight: 1,
          }}
        >
          {c.current_hp} / {c.max_hp}
        </span>
      </div>

      {/* Bottom-center: player (Twitch) name */}
      {c.twitch_display_name && (
        <div
          style={{
            position: 'absolute',
            bottom: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 92,
            letterSpacing: '0.12em',
            opacity: 0.92,
            whiteSpace: 'nowrap',
          }}
        >
          {c.twitch_display_name}
        </div>
      )}
    </div>
  );
}
