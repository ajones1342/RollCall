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
