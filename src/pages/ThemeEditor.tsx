import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import {
  CANVAS_PRESETS,
  DEFAULT_THEME,
  FONT_OPTIONS,
  TEXTURE_OPTIONS,
  mergeTheme,
  type Anchor,
  type Campaign,
  type Character,
  type FillMode,
  type TextAlign,
  type Theme,
} from '../lib/types';
import { CharacterCard1080, DiceToast, ScaleToFit, type DraggableElement } from './Overlay';
import { CombatTrackerCanvas } from './CombatOverlay';

const SAMPLE_CHARACTER: Character = {
  id: 'preview',
  campaign_id: 'preview',
  user_id: 'preview',
  name: 'Aragorn',
  race: 'Half-Elf',
  class: 'Ranger 5',
  max_hp: 50,
  current_hp: 38,
  strength: 16,
  agility: 14,
  constitution: 15,
  intelligence: 12,
  wisdom: 13,
  charisma: 11,
  display_order: 0,
  hidden_fields: [],
  temp_hp: 5,
  conditions: ['Poisoned'],
  death_save_successes: 0,
  death_save_failures: 0,
  inspiration: true,
  notes: '',
  twitch_display_name: 'StreamerName',
  // Inline SVG so the preview shows a portrait without an external request.
  twitch_avatar_url:
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="%237c2d12"/><text x="100" y="138" font-size="130" font-family="serif" fill="white" text-anchor="middle">A</text></svg>',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const SAMPLE_ROLL = {
  expression: '1d20+5',
  total: 18,
  detail: '[13] + 5 = 18',
  rolledAt: '2026-01-01T00:00:00.000Z',
  label: 'Athletics',
};

const SAMPLE_COMBAT = {
  active: true,
  round: 3,
  activeIndex: 1,
  combatants: [
    { id: 'sample-1', characterId: null, name: 'Goblin Boss', initiative: 22 },
    { id: 'sample-2', characterId: SAMPLE_CHARACTER.id, name: 'Aragorn', initiative: 18 },
    { id: 'sample-3', characterId: null, name: 'Goblin', initiative: 12 },
  ],
};

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export default function ThemeEditor() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [draft, setDraft] = useState<Theme>(DEFAULT_THEME);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate('/', { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!campaignId || !session) return;
    supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single()
      .then(({ data }) => {
        if (!data) {
          navigate('/gm', { replace: true });
          return;
        }
        const c = data as Campaign;
        if (c.owner_id !== session.user.id) {
          navigate(`/gm/${c.id}`, { replace: true });
          return;
        }
        setCampaign(c);
        setDraft(mergeTheme(c.theme));
      });
  }, [campaignId, session, navigate]);

  const dirty = useMemo(() => {
    if (!campaign) return false;
    const current = mergeTheme(campaign.theme);
    return JSON.stringify(draft) !== JSON.stringify(current);
  }, [draft, campaign]);

  // Auto-save with debounce.
  useEffect(() => {
    if (!campaign || !dirty) return;
    setSaveState('pending');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      setSaveState('saving');
      const { error } = await supabase
        .from('campaigns')
        .update({ theme: draft })
        .eq('id', campaign.id);
      if (error) {
        setSaveState('error');
        setErrorMsg(error.message);
        return;
      }
      setCampaign({ ...campaign, theme: draft });
      setErrorMsg(null);
      setSaveState('saved');
    }, 600);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [draft, campaign, dirty]);

  const setField = <K extends keyof Theme>(key: K, value: Theme[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const setFontSize = (key: keyof Theme['fontSizes'], value: number) => {
    setDraft((d) => ({
      ...d,
      fontSizes: { ...d.fontSizes, [key]: value },
    }));
  };

  const setPosition = <K extends keyof Theme['positions']>(
    key: K,
    value: Theme['positions'][K]
  ) => {
    setDraft((d) => ({
      ...d,
      positions: { ...d.positions, [key]: value },
    }));
  };

  const handleDrag = (element: DraggableElement, x: number, y: number) => {
    setDraft((d) => {
      const p = { ...d.positions };
      if (element === 'name') {
        p.nameX = x;
        p.nameY = y;
      } else if (element === 'attributes') {
        p.attributesX = x;
        p.attributesY = y;
      } else if (element === 'hp') {
        p.hpX = x;
        p.hpY = y;
      } else if (element === 'streamer') {
        p.streamerX = x;
        p.streamerY = y;
      } else if (element === 'portrait') {
        p.portraitX = x;
        p.portraitY = y;
      }
      return { ...d, positions: p };
    });
  };

  const reset = () => {
    if (!confirm('Reset all theme settings to defaults?')) return;
    setDraft(DEFAULT_THEME);
  };

  if (loading || !campaign) return <div className="p-8">Loading…</div>;

  return (
    <div className="min-h-screen p-6 max-w-[1600px] mx-auto">
      <div className="flex items-baseline gap-4 mb-2">
        <Link
          to={`/gm/${campaign.id}`}
          className="text-sm text-stone-400 hover:text-stone-200"
        >
          ← {campaign.name}
        </Link>
        <h1 className="text-3xl tracking-wider">Overlay Theme</h1>
      </div>
      <p className="text-sm text-stone-500 mb-6">
        Edits auto-save and push to live overlays via realtime — no need to refresh OBS unless its CEF cache acts up.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form */}
        <div className="space-y-6">
          <Section title="Canvas">
            <p className="text-xs text-stone-500 mb-3">
              The design size of the overlay. Sets the aspect ratio of the OBS
              Browser Source you'll add. Default 1920×1080 fits most player
              video tiles. Changing this on an existing theme may move
              elements off-screen — you'll need to reposition.
            </p>
            <div className="flex flex-wrap gap-1 mb-3">
              {CANVAS_PRESETS.map((p) => {
                const active =
                  draft.canvasWidth === p.width && draft.canvasHeight === p.height;
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      setField('canvasWidth', p.width);
                      setField('canvasHeight', p.height);
                    }}
                    className={
                      'text-xs px-3 py-1 rounded border ' +
                      (active
                        ? 'bg-purple-700 border-purple-600 text-white'
                        : 'bg-stone-900 border-stone-700 text-stone-300 hover:text-stone-100')
                    }
                  >
                    {p.label}
                    <span className="text-stone-500 ml-1.5">
                      {p.width}×{p.height}
                    </span>
                  </button>
                );
              })}
            </div>
            <SliderRow
              label="Width"
              value={draft.canvasWidth}
              min={400}
              max={3840}
              step={2}
              unit="px"
              onChange={(v) => setField('canvasWidth', v)}
            />
            <SliderRow
              label="Height"
              value={draft.canvasHeight}
              min={400}
              max={3840}
              step={2}
              unit="px"
              onChange={(v) => setField('canvasHeight', v)}
            />
          </Section>

          <Section title="Font">
            <select
              value={draft.fontFamily}
              onChange={(e) => setField('fontFamily', e.target.value)}
              className="input"
            >
              {Object.entries(groupBy(FONT_OPTIONS, 'category')).map(
                ([category, fonts]) => (
                  <optgroup key={category} label={category}>
                    {fonts.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                )
              )}
            </select>
            <div
              className="mt-3 p-3 bg-stone-900 border border-stone-700 rounded text-2xl text-stone-100"
              style={{ fontFamily: `'${draft.fontFamily}', serif` }}
            >
              The quick brown fox jumps over the lazy dog
            </div>
          </Section>

          <Section title="Text Fill">
            <div className="flex gap-2 mb-3">
              {(['solid', 'gradient', 'textured'] as FillMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setField('fillMode', mode)}
                  className={
                    'px-3 py-1.5 text-sm rounded border ' +
                    (draft.fillMode === mode
                      ? 'bg-purple-700 border-purple-600 text-white'
                      : 'bg-stone-900 border-stone-700 text-stone-300 hover:text-stone-100')
                  }
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            {draft.fillMode === 'solid' && (
              <ColorRow
                label="Color"
                value={draft.solidColor}
                onChange={(v) => setField('solidColor', v)}
              />
            )}

            {draft.fillMode === 'gradient' && (
              <div className="space-y-3">
                <ColorRow
                  label="From"
                  value={draft.gradientFrom}
                  onChange={(v) => setField('gradientFrom', v)}
                />
                <ColorRow
                  label="To"
                  value={draft.gradientTo}
                  onChange={(v) => setField('gradientTo', v)}
                />
                <SliderRow
                  label="Angle"
                  value={draft.gradientAngle}
                  min={0}
                  max={360}
                  step={1}
                  unit="°"
                  onChange={(v) => setField('gradientAngle', v)}
                />
              </div>
            )}

            {draft.fillMode === 'textured' && (
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <span className="text-sm text-stone-400 w-24">Pattern</span>
                  <select
                    value={draft.texturePreset}
                    onChange={(e) =>
                      setField('texturePreset', e.target.value as Theme['texturePreset'])
                    }
                    className="input"
                  >
                    {TEXTURE_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <ColorRow
                  label="Base"
                  value={draft.textureBase}
                  onChange={(v) => setField('textureBase', v)}
                />
                <ColorRow
                  label="Accent"
                  value={draft.textureAccent}
                  onChange={(v) => setField('textureAccent', v)}
                />
              </div>
            )}
          </Section>

          <Section title="Shadow">
            <SliderRow
              label="Strength"
              value={draft.shadowStrength}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setField('shadowStrength', v)}
            />
          </Section>

          <Section title="Effects">
            <ToggleRow
              label="HP change animations"
              checked={draft.enableHpAnimations}
              onChange={(v) => setField('enableHpAnimations', v)}
              hint="Brief red flash on damage, green on heal."
            />
            <ToggleRow
              label="Show character portraits"
              checked={draft.showPortraits}
              onChange={(v) => setField('showPortraits', v)}
              hint="Renders each player's Twitch avatar as a circle on the overlay. Position controls appear in Element Positions when enabled."
            />
          </Section>

          <Section title="Element Positions">
            <p className="text-xs text-stone-500 mb-3">
              Bottom-left of the canvas is (0, 0). Horizontal increases rightward;
              Vertical increases upward. Each element's anchor corner is whichever
              edge it visually clings to.
            </p>

            <PositionGroup label="Name">
              <SliderRow
                label="Horizontal"
                value={draft.positions.nameX}
                min={0}
                max={draft.canvasWidth}
                step={2}
                unit="px"
                onChange={(v) => setPosition('nameX', v)}
              />
              <SliderRow
                label="Vertical"
                value={draft.positions.nameY}
                min={0}
                max={draft.canvasHeight}
                step={2}
                unit="px"
                onChange={(v) => setPosition('nameY', v)}
              />
              <AnchorRow
                value={draft.positions.nameAnchor}
                onChange={(v) => setPosition('nameAnchor', v)}
              />
              <AlignRow
                value={draft.positions.nameAlign}
                onChange={(v) => setPosition('nameAlign', v)}
              />
            </PositionGroup>

            <PositionGroup label="Attributes">
              <SliderRow
                label="Horizontal"
                value={draft.positions.attributesX}
                min={0}
                max={draft.canvasWidth}
                step={2}
                unit="px"
                onChange={(v) => setPosition('attributesX', v)}
              />
              <SliderRow
                label="Vertical"
                value={draft.positions.attributesY}
                min={0}
                max={draft.canvasHeight}
                step={2}
                unit="px"
                onChange={(v) => setPosition('attributesY', v)}
              />
              <SliderRow
                label="Row gap"
                value={draft.positions.attributesRowGap}
                min={0}
                max={200}
                step={2}
                unit="px"
                onChange={(v) => setPosition('attributesRowGap', v)}
              />
            </PositionGroup>

            <PositionGroup label="HP">
              <SliderRow
                label="Horizontal"
                value={draft.positions.hpX}
                min={0}
                max={draft.canvasWidth}
                step={2}
                unit="px"
                onChange={(v) => setPosition('hpX', v)}
              />
              <SliderRow
                label="Vertical"
                value={draft.positions.hpY}
                min={0}
                max={draft.canvasHeight}
                step={2}
                unit="px"
                onChange={(v) => setPosition('hpY', v)}
              />
            </PositionGroup>

            <PositionGroup label="Streamer">
              <SliderRow
                label="Horizontal"
                value={draft.positions.streamerX}
                min={0}
                max={draft.canvasWidth}
                step={2}
                unit="px"
                onChange={(v) => setPosition('streamerX', v)}
              />
              <SliderRow
                label="Vertical"
                value={draft.positions.streamerY}
                min={0}
                max={draft.canvasHeight}
                step={2}
                unit="px"
                onChange={(v) => setPosition('streamerY', v)}
              />
              <SliderRow
                label="Width"
                value={draft.positions.streamerWidth}
                min={100}
                max={draft.canvasWidth}
                step={2}
                unit="px"
                onChange={(v) => setPosition('streamerWidth', v)}
              />
              <AlignRow
                value={draft.positions.streamerAlign}
                onChange={(v) => setPosition('streamerAlign', v)}
              />
            </PositionGroup>

            <PositionGroup label="Combat tracker">
              <SliderRow
                label="Horizontal"
                value={draft.positions.trackerX}
                min={0}
                max={draft.canvasWidth}
                step={2}
                unit="px"
                onChange={(v) => setPosition('trackerX', v)}
              />
              <SliderRow
                label="Vertical"
                value={draft.positions.trackerY}
                min={0}
                max={draft.canvasHeight}
                step={2}
                unit="px"
                onChange={(v) => setPosition('trackerY', v)}
              />
              <AnchorRow
                value={draft.positions.trackerAnchor}
                onChange={(v) => setPosition('trackerAnchor', v)}
              />
              <SliderRow
                label="Width"
                value={draft.positions.trackerWidth}
                min={300}
                max={draft.canvasWidth}
                step={4}
                unit="px"
                onChange={(v) => setPosition('trackerWidth', v)}
              />
              <SliderRow
                label="Row gap"
                value={draft.positions.trackerRowGap}
                min={0}
                max={80}
                step={1}
                unit="px"
                onChange={(v) => setPosition('trackerRowGap', v)}
              />
            </PositionGroup>

            <PositionGroup label="Dice toast">
              <SliderRow
                label="Horizontal"
                value={draft.positions.diceX}
                min={0}
                max={draft.canvasWidth}
                step={2}
                unit="px"
                onChange={(v) => setPosition('diceX', v)}
              />
              <SliderRow
                label="Vertical"
                value={draft.positions.diceY}
                min={0}
                max={draft.canvasHeight}
                step={2}
                unit="px"
                onChange={(v) => setPosition('diceY', v)}
              />
              <p className="text-xs text-stone-500 mt-1">
                Toast is anchored by its center, so this is where the middle of the popup lands.
              </p>
            </PositionGroup>

            {draft.showPortraits && (
              <PositionGroup label="Portrait">
                <SliderRow
                  label="Horizontal"
                  value={draft.positions.portraitX}
                  min={0}
                  max={draft.canvasWidth}
                  step={2}
                  unit="px"
                  onChange={(v) => setPosition('portraitX', v)}
                />
                <SliderRow
                  label="Vertical"
                  value={draft.positions.portraitY}
                  min={0}
                  max={draft.canvasHeight}
                  step={2}
                  unit="px"
                  onChange={(v) => setPosition('portraitY', v)}
                />
                <SliderRow
                  label="Size"
                  value={draft.positions.portraitSize}
                  min={40}
                  max={500}
                  step={2}
                  unit="px"
                  onChange={(v) => setPosition('portraitSize', v)}
                />
              </PositionGroup>
            )}
          </Section>

          <Section title="Font Sizes">
            <SliderRow
              label="Name"
              value={draft.fontSizes.name}
              min={48}
              max={180}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('name', v)}
            />
            <SliderRow
              label="Subtitle"
              value={draft.fontSizes.subtitle}
              min={24}
              max={96}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('subtitle', v)}
            />
            <SliderRow
              label="Conditions"
              value={draft.fontSizes.conditions}
              min={16}
              max={64}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('conditions', v)}
            />
            <SliderRow
              label="HP label"
              value={draft.fontSizes.hpLabel}
              min={20}
              max={80}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('hpLabel', v)}
            />
            <SliderRow
              label="HP value"
              value={draft.fontSizes.hpValue}
              min={40}
              max={160}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('hpValue', v)}
            />
            <SliderRow
              label="Attribute label"
              value={draft.fontSizes.attributeLabel}
              min={20}
              max={80}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('attributeLabel', v)}
            />
            <SliderRow
              label="Attribute value"
              value={draft.fontSizes.attributeValue}
              min={40}
              max={160}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('attributeValue', v)}
            />
            <SliderRow
              label="Streamer name"
              value={draft.fontSizes.streamerName}
              min={32}
              max={140}
              step={2}
              unit="px"
              onChange={(v) => setFontSize('streamerName', v)}
            />
          </Section>

          <div className="flex items-center gap-3 sticky bottom-0 bg-stone-900 py-3">
            <button
              onClick={reset}
              className="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded text-sm"
            >
              Reset to defaults
            </button>
            <SaveIndicator state={saveState} dirty={dirty} error={errorMsg} />
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-6 self-start">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wide text-stone-400">
              Live preview (sample character)
            </p>
            <button
              onClick={() => setEditMode((v) => !v)}
              className={
                'text-xs px-3 py-1 rounded border ' +
                (editMode
                  ? 'bg-purple-700 border-purple-600 text-white'
                  : 'bg-stone-800 border-stone-600 text-stone-300 hover:text-stone-100')
              }
            >
              {editMode ? 'Editing positions' : 'Edit positions'}
            </button>
          </div>
          <div
            className="relative border border-stone-700 rounded overflow-hidden"
            style={{
              aspectRatio: `${draft.canvasWidth} / ${draft.canvasHeight}`,
              background: '#374151',
            }}
          >
            <ScaleToFit
              canvasWidth={draft.canvasWidth}
              canvasHeight={draft.canvasHeight}
            >
              <CharacterCard1080
                c={SAMPLE_CHARACTER}
                theme={draft}
                editable={editMode}
                onPositionChange={handleDrag}
              />
              <DiceToast
                roll={SAMPLE_ROLL}
                theme={draft}
                forceVisible={editMode}
              />
              <CombatTrackerCanvas
                theme={draft}
                combat={SAMPLE_COMBAT}
                characters={[SAMPLE_CHARACTER]}
                forceVisible
              />
            </ScaleToFit>
          </div>
          <p className="text-xs text-stone-500 mt-2">
            {editMode
              ? 'Click and drag any element to reposition. Sliders update with you.'
              : 'Preview shows a placeholder character. Real characters in your campaign inherit these settings on their overlay URL.'}
          </p>
        </div>
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

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl mb-3">{props.title}</h2>
      <div className="bg-stone-800 border border-stone-700 rounded p-4 space-y-1">
        {props.children}
      </div>
    </section>
  );
}

function PositionGroup(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-stone-700 first:border-t-0 pt-3 first:pt-0 mt-3 first:mt-0">
      <div className="text-sm uppercase tracking-wide text-stone-400 mb-2">
        {props.label}
      </div>
      <div className="space-y-1">{props.children}</div>
    </div>
  );
}

function AnchorRow(props: { value: Anchor; onChange: (v: Anchor) => void }) {
  const cell = (a: Anchor) => (
    <button
      key={a}
      onClick={() => props.onChange(a)}
      className={
        'h-7 rounded text-xs ' +
        (props.value === a
          ? 'bg-purple-700 text-white'
          : 'bg-stone-900 text-stone-400 hover:text-stone-100 border border-stone-700')
      }
      title={a}
    >
      {a === 'top-left'
        ? '↖'
        : a === 'top-right'
          ? '↗'
          : a === 'bottom-left'
            ? '↙'
            : '↘'}
    </button>
  );
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-stone-400 w-32">Grow from</span>
      <div className="grid grid-cols-2 gap-1 w-20">
        {cell('top-left')}
        {cell('top-right')}
        {cell('bottom-left')}
        {cell('bottom-right')}
      </div>
    </div>
  );
}

function ToggleRow(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none py-1">
      <input
        type="checkbox"
        className="w-4 h-4 mt-1"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>
        <span className="block text-stone-200 text-sm">{props.label}</span>
        {props.hint && (
          <span className="block text-xs text-stone-500 mt-0.5">{props.hint}</span>
        )}
      </span>
    </label>
  );
}

function AlignRow(props: { value: TextAlign; onChange: (v: TextAlign) => void }) {
  const opts: { v: TextAlign; label: string }[] = [
    { v: 'left', label: 'L' },
    { v: 'center', label: 'C' },
    { v: 'right', label: 'R' },
  ];
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-stone-400 w-32">Text align</span>
      <div className="flex gap-1">
        {opts.map(({ v, label }) => (
          <button
            key={v}
            onClick={() => props.onChange(v)}
            className={
              'w-9 h-7 rounded text-xs ' +
              (props.value === v
                ? 'bg-purple-700 text-white'
                : 'bg-stone-900 text-stone-400 hover:text-stone-100 border border-stone-700')
            }
            title={v}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorRow(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="text-sm text-stone-400 w-24">{props.label}</span>
      <input
        type="color"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-12 h-9 rounded border border-stone-600 bg-stone-900"
      />
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="input flex-1 font-mono text-sm"
      />
    </label>
  );
}

function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="text-sm text-stone-400 w-32">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        className="flex-1"
      />
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) props.onChange(v);
        }}
        className="input w-20 text-right tabular-nums"
      />
      {props.unit && (
        <span className="text-sm text-stone-500 w-4">{props.unit}</span>
      )}
    </label>
  );
}

function SaveIndicator(props: {
  state: SaveState;
  dirty: boolean;
  error: string | null;
}) {
  if (props.state === 'error') {
    return (
      <span className="text-sm text-red-400">Save failed: {props.error}</span>
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

function groupBy<T, K extends string>(
  items: T[],
  keyFn: K extends keyof T ? K : never
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = String(item[keyFn as keyof T]);
    (out[k] ??= []).push(item);
  }
  return out;
}
