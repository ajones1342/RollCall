import type { CSSProperties } from 'react';

export type Character = {
  id: string;
  campaign_id: string;
  user_id: string;
  name: string;
  race: string;
  class: string;
  max_hp: number;
  current_hp: number;
  strength: number;
  agility: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  display_order: number;
  hidden_fields: HideableField[];
  temp_hp: number;
  conditions: string[];
  death_save_successes: number;
  death_save_failures: number;
  inspiration: boolean;
  table_points: number;
  notes: string;
  twitch_display_name: string | null;
  twitch_avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignSettings = {
  // When true, the player-facing Party Information panel honors each
  // character's hidden_fields list (so race/HP/etc. that the player chose
  // to hide from the OBS overlay are also hidden from teammates).
  // When false (default), the party panel always shows everything —
  // hidden_fields only affects the OBS overlay.
  partyViewRespectsHideToggles?: boolean;

  // Combat / initiative tracker state. Undefined or .active=false means no
  // combat is running. Designed to be replayable from a webhook payload —
  // an external source (e.g. a Fantasy Grounds extension) can POST the full
  // CombatState and replace this field idempotently.
  combat?: CombatState;

  // Most recent GM dice roll. Overlay watches this for changes (by
  // rolledAt timestamp) and shows a brief toast.
  lastRoll?: DiceRoll;

  // Per-event Twitch chat alerts. All default off. The GM toggles these on
  // the campaign manage page; alerts only fire when a broadcast channel is
  // linked. Alerts are observed and posted from the campaign manage page,
  // so the GM needs that page open during play.
  alerts?: {
    onRoundAdvance?: boolean; // "Round 3 — Aragorn's turn"
    onLowHp?: boolean; // crosses 25% threshold downward
    onZeroHp?: boolean; // hits exactly 0
  };

  // Scene presets let the GM globally hide overlay elements for ALL players
  // at once — useful for nested-scene setups (e.g. a "stream ending" scene
  // that shows only the streamer name/avatar, hiding character info). The
  // GM defines named presets and toggles which is active; overlays merge
  // the active preset's hideFields on top of each character's own
  // hidden_fields. activeScenePresetId === null/undefined means no preset
  // is applied (default behavior).
  scenePresets?: ScenePreset[];
  activeScenePresetId?: string | null;

  // Table points (Klout / Inspiration-like grant points). Opt-in per
  // campaign — when undefined or enabled=false, no UI surfaces it and the
  // overlay element is suppressed. Label is GM-chosen ("Klout", "Hero
  // Points", "Bennies", etc.); icon is a short glyph rendered next to the
  // count on the overlay.
  tablePoints?: TablePointsConfig;
};

export type TablePointsConfig = {
  enabled: boolean;
  label: string;
  icon?: string;
};

// Resolve the table-points config if enabled, else null. Callers should
// branch on the result to decide whether to render UI / accept webhook
// updates / etc.
export function tablePointsConfig(
  settings: CampaignSettings | null | undefined
): TablePointsConfig | null {
  const cfg = settings?.tablePoints;
  if (!cfg || !cfg.enabled) return null;
  return cfg;
}

export type ScenePreset = {
  id: string;
  name: string;
  hideFields: HideableField[];
  hideDice: boolean;
  hideActiveTurnGlow: boolean;
};

export function activeScenePreset(
  settings: CampaignSettings | null | undefined
): ScenePreset | null {
  const id = settings?.activeScenePresetId;
  if (!id) return null;
  return settings?.scenePresets?.find((p) => p.id === id) ?? null;
}

export type DiceRoll = {
  expression: string; // e.g. "1d20+5"
  total: number;
  detail: string; // e.g. "[14] + 5 = 19"
  rolledAt: string; // ISO timestamp; lets the overlay detect a fresh roll
  label?: string; // optional context line, e.g. "Athletics" or character name
};

// Roll a dice expression of the form NdM, NdM+K, NdM-K (whitespace ok).
// Returns null if the expression doesn't parse or limits are exceeded.
export function rollDice(expression: string): DiceRoll | null {
  const expr = expression.trim();
  const m = expr.replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  const count = parseInt(m[1] || '1', 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;
  if (count <= 0 || count > 100 || sides <= 0 || sides > 1000) return null;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + mod;
  const rollList = `[${rolls.join(', ')}]`;
  const detail =
    mod === 0
      ? `${rollList} = ${total}`
      : mod > 0
        ? `${rollList} + ${mod} = ${total}`
        : `${rollList} - ${-mod} = ${total}`;
  return { expression: expr, total, detail, rolledAt: new Date().toISOString() };
}

// One combatant in the initiative order. PCs link to a characters row via
// characterId so the overlay can highlight that character's card. NPCs/
// monsters use only the name + initiative.
export type Combatant = {
  id: string; // local id; uuid generated client-side
  characterId?: string | null; // null for NPCs / monsters
  name: string;
  initiative: number;
};

export type CombatState = {
  active: boolean;
  round: number;
  activeIndex: number; // index into combatants[] of whose turn it is
  combatants: Combatant[];
};

// Sort combatants by initiative descending (5e standard). Stable: ties keep
// their existing relative order so a re-sort doesn't reshuffle equal rolls.
export function sortByInitiative(combatants: Combatant[]): Combatant[] {
  return [...combatants]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.initiative - a.c.initiative || a.i - b.i)
    .map((x) => x.c);
}

export function advanceTurn(state: CombatState): CombatState {
  if (!state.active || state.combatants.length === 0) return state;
  const next = state.activeIndex + 1;
  if (next >= state.combatants.length) {
    return { ...state, activeIndex: 0, round: state.round + 1 };
  }
  return { ...state, activeIndex: next };
}

export function previousTurn(state: CombatState): CombatState {
  if (!state.active || state.combatants.length === 0) return state;
  const prev = state.activeIndex - 1;
  if (prev < 0) {
    return {
      ...state,
      activeIndex: Math.max(0, state.combatants.length - 1),
      round: Math.max(1, state.round - 1),
    };
  }
  return { ...state, activeIndex: prev };
}

export function activeCombatant(state: CombatState | undefined): Combatant | null {
  if (!state || !state.active) return null;
  return state.combatants[state.activeIndex] ?? null;
}

export type Campaign = {
  id: string;
  owner_id: string;
  name: string;
  theme: Partial<Theme>;
  settings: CampaignSettings;
  created_at: string;
};

// ============================================================
// Overlay theme (per-campaign, configured via the theme editor)
// ============================================================

export const FONT_OPTIONS: { value: string; label: string; category: string }[] = [
  { value: 'Cinzel', label: 'Cinzel', category: 'Fantasy' },
  { value: 'IM Fell English', label: 'IM Fell English', category: 'Fantasy' },
  { value: 'Cormorant SC', label: 'Cormorant SC', category: 'Fantasy' },
  { value: 'Pirata One', label: 'Pirata One', category: 'Fantasy' },
  { value: 'Audiowide', label: 'Audiowide', category: 'Sci-Fi' },
  { value: 'Orbitron', label: 'Orbitron', category: 'Sci-Fi' },
  { value: 'Wallpoet', label: 'Wallpoet', category: 'Sci-Fi' },
  { value: 'VT323', label: 'VT323 (terminal)', category: 'Sci-Fi' },
  { value: 'Press Start 2P', label: 'Press Start 2P (8-bit)', category: 'Sci-Fi' },
  { value: 'Major Mono Display', label: 'Major Mono Display', category: 'Sci-Fi' },
  { value: 'Bangers', label: 'Bangers', category: 'Comic' },
  { value: 'Luckiest Guy', label: 'Luckiest Guy', category: 'Comic' },
  { value: 'Inter', label: 'Inter', category: 'Modern' },
];

export type FontSizes = {
  name: number;
  subtitle: number;
  conditions: number;
  hpLabel: number;
  hpValue: number;
  attributeLabel: number;
  attributeValue: number;
  streamerName: number;
  points: number;
};

export type FillMode = 'solid' | 'gradient' | 'textured';

export type TexturePreset = 'stripes' | 'dots' | 'check' | 'crosshatch';

export const TEXTURE_OPTIONS: { value: TexturePreset; label: string }[] = [
  { value: 'stripes', label: 'Diagonal Stripes' },
  { value: 'dots', label: 'Halftone Dots' },
  { value: 'check', label: 'Checkerboard' },
  { value: 'crosshatch', label: 'Crosshatch' },
];

// Element positions in a single bottom-left coordinate system.
// (0, 0) = bottom-left of the 1920x1080 canvas. (1920, 1080) = top-right.
//
// Each element has:
//   - x, y: position in bottom-left coords. Refers to the anchor corner.
//   - anchor: which corner of the element (x, y) refers to. The element
//     extends away from this corner. Lets the GM put the name in the lower
//     right and have it grow up-left, etc.
//   - align: text alignment within the element ('left' | 'center' | 'right').
//
// User-facing sliders show "Horizontal" and "Vertical" with uniform direction
// for every element: increase X = move right, increase Y = move up.

export type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type TextAlign = 'left' | 'center' | 'right';

export type Positions = {
  nameX: number;
  nameY: number;
  nameAnchor: Anchor;
  nameAlign: TextAlign;
  attributesX: number;
  attributesY: number;
  attributesAnchor: Anchor;
  attributesAlign: TextAlign;
  attributesRowGap: number;
  hpX: number;
  hpY: number;
  hpAnchor: Anchor;
  hpAlign: TextAlign;
  streamerX: number;
  streamerY: number;
  streamerAnchor: Anchor;
  streamerAlign: TextAlign;
  streamerWidth: number;
  portraitX: number;
  portraitY: number;
  portraitSize: number;
  diceX: number;
  diceY: number;
  trackerX: number;
  trackerY: number;
  trackerAnchor: Anchor;
  trackerWidth: number;
  trackerRowGap: number;
  pointsX: number;
  pointsY: number;
  pointsAnchor: Anchor;
  pointsAlign: TextAlign;
};

export type ElementColorKey =
  // character card
  | 'name'
  | 'subtitle'
  | 'conditions'
  | 'hpLabel'
  | 'hpValue'
  | 'attributeLabel'
  | 'attributeValue'
  | 'streamerName'
  | 'tablePoints'
  // combat tracker
  | 'trackerRound'
  | 'trackerInit'
  | 'trackerName'
  | 'trackerHp'
  | 'trackerConditions'
  // dice toast
  | 'diceLabel'
  | 'diceExpression'
  | 'diceTotal'
  | 'diceDetail';

export type ElementColors = Partial<Record<ElementColorKey, string>>;

export type Theme = {
  fontFamily: string;
  fillMode: FillMode;
  solidColor: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  texturePreset: TexturePreset;
  textureBase: string;
  textureAccent: string;
  shadowStrength: number;
  edgePadding: number; // legacy fallback for themes saved before positions existed
  positions: Positions;
  fontSizes: FontSizes;
  enableHpAnimations: boolean;
  showPortraits: boolean;
  canvasWidth: number;
  canvasHeight: number;
  combatCanvasWidth: number;
  combatCanvasHeight: number;
  elementColors: ElementColors;
};

export const CANVAS_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '16:10', width: 1920, height: 1200 },
  { label: '4:3', width: 1440, height: 1080 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '21:9', width: 2520, height: 1080 },
];

export function defaultPositions(edgePadding: number = 80): Positions {
  return {
    nameX: edgePadding,
    nameY: 1080 - edgePadding,
    nameAnchor: 'top-left',
    nameAlign: 'left',
    attributesX: 1920 - edgePadding,
    attributesY: 1080 - edgePadding,
    attributesAnchor: 'top-right',
    attributesAlign: 'right',
    attributesRowGap: 88,
    hpX: edgePadding,
    hpY: edgePadding,
    hpAnchor: 'bottom-left',
    hpAlign: 'left',
    streamerX: 0,
    streamerY: edgePadding + 20,
    streamerAnchor: 'bottom-left',
    streamerAlign: 'center',
    streamerWidth: 1920,
    portraitX: edgePadding,
    portraitY: 1080 - edgePadding,
    portraitSize: 200,
    diceX: 1920 / 2,
    diceY: 1080 / 2,
    trackerX: edgePadding,
    trackerY: 1080 - edgePadding,
    trackerAnchor: 'top-left',
    trackerWidth: 1000,
    trackerRowGap: 18,
    // Points: default to the top-center area, above the name block, so it
    // reads like a status pip. GM will reposition with the theme editor.
    pointsX: 1920 / 2,
    pointsY: 1080 - edgePadding,
    pointsAnchor: 'top-left',
    pointsAlign: 'center',
  };
}

// Convert a stored Positions blob — possibly in the old anchored form
// (top/left/right/bottom) — to the new bottom-left {x, y} form.
function migratePositions(stored: unknown, edgePadding: number): Positions {
  const def = defaultPositions(edgePadding);
  if (!stored || typeof stored !== 'object') return def;
  const s = stored as Record<string, unknown>;
  const num = (k: string): number | undefined =>
    typeof s[k] === 'number' ? (s[k] as number) : undefined;

  const anchor = (k: string): Anchor | undefined => {
    const v = s[k];
    return v === 'top-left' || v === 'top-right' || v === 'bottom-left' || v === 'bottom-right'
      ? v
      : undefined;
  };
  const align = (k: string): TextAlign | undefined => {
    const v = s[k];
    return v === 'left' || v === 'center' || v === 'right' ? v : undefined;
  };

  // If new keys are present, treat as the new shape; fill in any missing.
  if (
    num('nameX') !== undefined ||
    num('hpX') !== undefined ||
    num('attributesX') !== undefined
  ) {
    return {
      nameX: num('nameX') ?? def.nameX,
      nameY: num('nameY') ?? def.nameY,
      nameAnchor: anchor('nameAnchor') ?? def.nameAnchor,
      nameAlign: align('nameAlign') ?? def.nameAlign,
      attributesX: num('attributesX') ?? def.attributesX,
      attributesY: num('attributesY') ?? def.attributesY,
      attributesAnchor: anchor('attributesAnchor') ?? def.attributesAnchor,
      attributesAlign: align('attributesAlign') ?? def.attributesAlign,
      attributesRowGap: num('attributesRowGap') ?? def.attributesRowGap,
      hpX: num('hpX') ?? def.hpX,
      hpY: num('hpY') ?? def.hpY,
      hpAnchor: anchor('hpAnchor') ?? def.hpAnchor,
      hpAlign: align('hpAlign') ?? def.hpAlign,
      streamerX: num('streamerX') ?? def.streamerX,
      streamerY: num('streamerY') ?? def.streamerY,
      streamerAnchor: anchor('streamerAnchor') ?? def.streamerAnchor,
      streamerAlign: align('streamerAlign') ?? def.streamerAlign,
      streamerWidth: num('streamerWidth') ?? def.streamerWidth,
      portraitX: num('portraitX') ?? def.portraitX,
      portraitY: num('portraitY') ?? def.portraitY,
      portraitSize: num('portraitSize') ?? def.portraitSize,
      diceX: num('diceX') ?? def.diceX,
      diceY: num('diceY') ?? def.diceY,
      trackerX: num('trackerX') ?? def.trackerX,
      trackerY: num('trackerY') ?? def.trackerY,
      trackerAnchor: anchor('trackerAnchor') ?? def.trackerAnchor,
      trackerWidth: num('trackerWidth') ?? def.trackerWidth,
      trackerRowGap: num('trackerRowGap') ?? def.trackerRowGap,
      pointsX: num('pointsX') ?? def.pointsX,
      pointsY: num('pointsY') ?? def.pointsY,
      pointsAnchor: anchor('pointsAnchor') ?? def.pointsAnchor,
      pointsAlign: align('pointsAlign') ?? def.pointsAlign,
    };
  }

  // Otherwise migrate from old top/left/right/bottom semantics.
  const oldStreamerLeft = num('streamerLeft') ?? 0;
  const oldStreamerRight = num('streamerRight') ?? 0;
  return {
    nameX: num('nameLeft') ?? def.nameX,
    nameY: num('nameTop') !== undefined ? 1080 - (num('nameTop') as number) : def.nameY,
    nameAnchor: def.nameAnchor,
    nameAlign: def.nameAlign,
    attributesX:
      num('attributesRight') !== undefined
        ? 1920 - (num('attributesRight') as number)
        : def.attributesX,
    attributesY:
      num('attributesTop') !== undefined
        ? 1080 - (num('attributesTop') as number)
        : def.attributesY,
    attributesAnchor: def.attributesAnchor,
    attributesAlign: def.attributesAlign,
    attributesRowGap: def.attributesRowGap,
    hpX: num('hpLeft') ?? def.hpX,
    hpY: num('hpBottom') ?? def.hpY,
    hpAnchor: def.hpAnchor,
    hpAlign: def.hpAlign,
    streamerX: oldStreamerLeft,
    streamerY: num('streamerBottom') ?? def.streamerY,
    streamerAnchor: def.streamerAnchor,
    streamerAlign: def.streamerAlign,
    streamerWidth: 1920 - oldStreamerLeft - oldStreamerRight,
    portraitX: def.portraitX,
    portraitY: def.portraitY,
    portraitSize: def.portraitSize,
    diceX: def.diceX,
    diceY: def.diceY,
    trackerX: def.trackerX,
    trackerY: def.trackerY,
    trackerAnchor: def.trackerAnchor,
    trackerWidth: def.trackerWidth,
    trackerRowGap: def.trackerRowGap,
    pointsX: def.pointsX,
    pointsY: def.pointsY,
    pointsAnchor: def.pointsAnchor,
    pointsAlign: def.pointsAlign,
  };
}

export const DEFAULT_THEME: Theme = {
  fontFamily: 'Cormorant SC',
  fillMode: 'solid',
  solidColor: '#ffffff',
  enableHpAnimations: true,
  showPortraits: false,
  canvasWidth: 1920,
  canvasHeight: 1080,
  combatCanvasWidth: 1920,
  combatCanvasHeight: 1080,
  elementColors: {},
  gradientFrom: '#02fdfc',
  gradientTo: '#c22cff',
  gradientAngle: 85,
  texturePreset: 'stripes',
  textureBase: '#fbbf24',
  textureAccent: '#7c2d12',
  shadowStrength: 0.9,
  edgePadding: 80,
  positions: defaultPositions(80),
  fontSizes: {
    name: 96,
    subtitle: 48,
    conditions: 32,
    hpLabel: 44,
    hpValue: 84,
    attributeLabel: 44,
    attributeValue: 80,
    streamerName: 92,
    points: 64,
  },
};

// Fill in any missing keys with defaults. Persisted theme is Partial<Theme>;
// resolved theme passed to render is full Theme.
export function mergeTheme(partial: Partial<Theme> | null | undefined): Theme {
  if (!partial) return DEFAULT_THEME;
  const edgePadding = partial.edgePadding ?? DEFAULT_THEME.edgePadding;
  return {
    fontFamily: partial.fontFamily ?? DEFAULT_THEME.fontFamily,
    fillMode: partial.fillMode ?? DEFAULT_THEME.fillMode,
    solidColor: partial.solidColor ?? DEFAULT_THEME.solidColor,
    gradientFrom: partial.gradientFrom ?? DEFAULT_THEME.gradientFrom,
    gradientTo: partial.gradientTo ?? DEFAULT_THEME.gradientTo,
    gradientAngle: partial.gradientAngle ?? DEFAULT_THEME.gradientAngle,
    texturePreset: partial.texturePreset ?? DEFAULT_THEME.texturePreset,
    textureBase: partial.textureBase ?? DEFAULT_THEME.textureBase,
    textureAccent: partial.textureAccent ?? DEFAULT_THEME.textureAccent,
    shadowStrength: partial.shadowStrength ?? DEFAULT_THEME.shadowStrength,
    edgePadding,
    positions: migratePositions(partial.positions, edgePadding),
    fontSizes: { ...DEFAULT_THEME.fontSizes, ...(partial.fontSizes ?? {}) },
    enableHpAnimations: partial.enableHpAnimations ?? DEFAULT_THEME.enableHpAnimations,
    showPortraits: partial.showPortraits ?? DEFAULT_THEME.showPortraits,
    canvasWidth: partial.canvasWidth ?? DEFAULT_THEME.canvasWidth,
    canvasHeight: partial.canvasHeight ?? DEFAULT_THEME.canvasHeight,
    // Combat canvas defaults to the character canvas if unset, so older
    // themes look identical until the GM customizes it separately.
    combatCanvasWidth:
      partial.combatCanvasWidth ??
      partial.canvasWidth ??
      DEFAULT_THEME.combatCanvasWidth,
    combatCanvasHeight:
      partial.combatCanvasHeight ??
      partial.canvasHeight ??
      DEFAULT_THEME.combatCanvasHeight,
    elementColors: { ...(partial.elementColors ?? {}) },
  };
}

// CSS background string for a textured fill. Used with background-clip: text
// to fill text with a repeating CSS-only pattern (no images required).
export function textureBackground(
  preset: TexturePreset,
  base: string,
  accent: string
): string {
  switch (preset) {
    case 'stripes':
      return `repeating-linear-gradient(45deg, ${base} 0px, ${base} 6px, ${accent} 6px, ${accent} 12px)`;
    case 'dots':
      return `radial-gradient(${base} 25%, ${accent} 26%) 0/16px 16px`;
    case 'check':
      return `linear-gradient(45deg, ${base} 25%, ${accent} 25%, ${accent} 50%, ${base} 50%, ${base} 75%, ${accent} 75%) 0/24px 24px`;
    case 'crosshatch':
      return `repeating-linear-gradient(45deg, ${base} 0 2px, transparent 2px 10px), repeating-linear-gradient(-45deg, ${base} 0 2px, ${accent} 2px 10px)`;
  }
}

// Convert (x, y) in bottom-left coords + an anchor corner into the
// corresponding CSS positioning props. The anchor corner of the element
// will be placed at canvas position (x, y) within a canvasWidth x
// canvasHeight design space.
export function anchorCss(
  anchor: Anchor,
  x: number,
  y: number,
  canvasWidth: number = 1920,
  canvasHeight: number = 1080
): CSSProperties {
  const css: CSSProperties = { position: 'absolute' };
  if (anchor === 'top-left' || anchor === 'top-right') {
    css.top = canvasHeight - y;
  } else {
    css.bottom = y;
  }
  if (anchor === 'top-left' || anchor === 'bottom-left') {
    css.left = x;
  } else {
    css.right = canvasWidth - x;
  }
  return css;
}

// Map a TextAlign value to a flex justify-content / align-items value.
export function alignToFlex(align: TextAlign): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'left') return 'flex-start';
  if (align === 'right') return 'flex-end';
  return 'center';
}

// Per-element style: if the GM has set an override color for this element
// key, return a flat solid color. Otherwise fall back to the theme's
// global fill (gradient/solid/textured). Element overrides are always
// solid colors — gradient-per-element is overkill for v1.
export function elementFillStyle(theme: Theme, key: ElementColorKey): CSSProperties {
  const override = theme.elementColors?.[key];
  if (override && override.length > 0) {
    return { color: override };
  }
  return fillStyle(theme);
}

// Inline style fragment to apply the theme's fill (solid color, gradient, or
// textured pattern) to a text element.
export function fillStyle(theme: Theme): CSSProperties {
  if (theme.fillMode === 'solid') {
    return { color: theme.solidColor };
  }
  const bg =
    theme.fillMode === 'gradient'
      ? `linear-gradient(${theme.gradientAngle}deg, ${theme.gradientFrom}, ${theme.gradientTo})`
      : textureBackground(theme.texturePreset, theme.textureBase, theme.textureAccent);
  return {
    background: bg,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
  };
}

export const ATTRIBUTE_KEYS = [
  'strength',
  'agility',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  strength: 'STR',
  agility: 'AGI',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
};

export type HideableField =
  | 'name'
  | 'race'
  | 'class'
  | 'hp'
  | 'attributes'
  | 'inspiration'
  | 'conditions'
  | 'streamer_name'
  | 'table_points';

export const HIDEABLE_FIELDS: { key: HideableField; label: string }[] = [
  { key: 'name', label: 'Character name' },
  { key: 'race', label: 'Race' },
  { key: 'class', label: 'Class' },
  { key: 'hp', label: 'HP' },
  { key: 'attributes', label: 'Attributes' },
  { key: 'inspiration', label: 'Inspiration star' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'streamer_name', label: 'Streamer name' },
  { key: 'table_points', label: 'Table points' },
];

const KNOWN_FIELDS: ReadonlySet<HideableField> = new Set([
  'name',
  'race',
  'class',
  'hp',
  'attributes',
  'inspiration',
  'conditions',
  'streamer_name',
  'table_points',
]);

// 5e Player's Handbook conditions. Click-to-toggle on the player edit page.
export const STANDARD_CONDITIONS: readonly string[] = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
];

// Backward compat: an earlier version had a single 'subtitle' toggle that
// hid race+class together. Old rows with 'subtitle' in hidden_fields get
// expanded to ['race', 'class']; unknown values are dropped.
export function normalizeHiddenFields(
  input: readonly string[] | null | undefined
): HideableField[] {
  if (!input) return [];
  const set = new Set<HideableField>();
  for (const f of input) {
    if (f === 'subtitle') {
      set.add('race');
      set.add('class');
      continue;
    }
    if (KNOWN_FIELDS.has(f as HideableField)) {
      set.add(f as HideableField);
    }
  }
  return Array.from(set);
}
