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
  twitch_display_name: string | null;
  twitch_avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Campaign = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
};

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
  | 'streamer_name';

export const HIDEABLE_FIELDS: { key: HideableField; label: string }[] = [
  { key: 'name', label: 'Character name' },
  { key: 'race', label: 'Race' },
  { key: 'class', label: 'Class' },
  { key: 'hp', label: 'HP' },
  { key: 'attributes', label: 'Attributes' },
  { key: 'streamer_name', label: 'Streamer name' },
];

const KNOWN_FIELDS: ReadonlySet<HideableField> = new Set([
  'name',
  'race',
  'class',
  'hp',
  'attributes',
  'streamer_name',
]);

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
