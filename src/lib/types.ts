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
  notes: string;
  twitch_display_name: string | null;
  twitch_avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Campaign = {
  id: string;
  owner_id: string;
  name: string;
  theme: Partial<Theme>;
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
};

export type FillMode = 'solid' | 'gradient' | 'textured';

export type TexturePreset = 'stripes' | 'dots' | 'check' | 'crosshatch';

export const TEXTURE_OPTIONS: { value: TexturePreset; label: string }[] = [
  { value: 'stripes', label: 'Diagonal Stripes' },
  { value: 'dots', label: 'Halftone Dots' },
  { value: 'check', label: 'Checkerboard' },
  { value: 'crosshatch', label: 'Crosshatch' },
];

export type Positions = {
  nameTop: number;
  nameLeft: number;
  attributesTop: number;
  attributesRight: number;
  attributesBottom: number;
  hpBottom: number;
  hpLeft: number;
  streamerBottom: number;
  streamerLeft: number;
  streamerRight: number;
};

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
};

export function defaultPositions(edgePadding: number): Positions {
  return {
    nameTop: edgePadding,
    nameLeft: edgePadding,
    attributesTop: edgePadding,
    attributesRight: edgePadding,
    attributesBottom: edgePadding,
    hpBottom: edgePadding,
    hpLeft: edgePadding,
    streamerBottom: edgePadding + 20,
    streamerLeft: 0,
    streamerRight: 0,
  };
}

export const DEFAULT_THEME: Theme = {
  fontFamily: 'Cinzel',
  fillMode: 'gradient',
  solidColor: '#f5f5f4',
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
  },
};

// Fill in any missing keys with defaults. Persisted theme is Partial<Theme>;
// resolved theme passed to render is full Theme.
export function mergeTheme(partial: Partial<Theme> | null | undefined): Theme {
  if (!partial) return DEFAULT_THEME;
  const edgePadding = partial.edgePadding ?? DEFAULT_THEME.edgePadding;
  // Backward compat: if a stored theme predates the positions field, derive
  // positions from edgePadding so the old visual layout is preserved.
  const fallbackPositions = defaultPositions(edgePadding);
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
    positions: { ...fallbackPositions, ...(partial.positions ?? {}) },
    fontSizes: { ...DEFAULT_THEME.fontSizes, ...(partial.fontSizes ?? {}) },
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
  | 'streamer_name';

export const HIDEABLE_FIELDS: { key: HideableField; label: string }[] = [
  { key: 'name', label: 'Character name' },
  { key: 'race', label: 'Race' },
  { key: 'class', label: 'Class' },
  { key: 'hp', label: 'HP' },
  { key: 'attributes', label: 'Attributes' },
  { key: 'inspiration', label: 'Inspiration star' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'streamer_name', label: 'Streamer name' },
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
