-- RollCall — Supabase schema
-- Run this in the Supabase SQL Editor for your project.
-- Safe to re-run: uses IF NOT EXISTS / drop+create for triggers.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  theme jsonb not null default '{}',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  race text not null default '',
  class text not null default '',
  max_hp int not null default 1,
  current_hp int not null default 1,
  strength int not null default 10,
  agility int not null default 10,
  constitution int not null default 10,
  intelligence int not null default 10,
  wisdom int not null default 10,
  charisma int not null default 10,
  display_order int not null default 0,
  hidden_fields text[] not null default '{}',
  temp_hp int not null default 0,
  conditions text[] not null default '{}',
  death_save_successes int not null default 0 check (death_save_successes between 0 and 3),
  death_save_failures int not null default 0 check (death_save_failures between 0 and 3),
  inspiration boolean not null default false,
  notes text not null default '',
  twitch_display_name text,
  twitch_avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create index if not exists characters_campaign_idx on public.characters (campaign_id);

-- ============================================================
-- Auto-update updated_at on character changes
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists characters_touch_updated_at on public.characters;
create trigger characters_touch_updated_at
before update on public.characters
for each row execute function public.touch_updated_at();

-- ============================================================
-- Row-Level Security
-- ============================================================

alter table public.campaigns enable row level security;
alter table public.characters enable row level security;

-- Campaigns: anyone with the UUID can read (overlay needs this).
-- Only the owner can mutate.
drop policy if exists campaigns_select_anyone on public.campaigns;
create policy campaigns_select_anyone
  on public.campaigns for select
  using (true);

drop policy if exists campaigns_insert_authenticated on public.campaigns;
create policy campaigns_insert_authenticated
  on public.campaigns for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists campaigns_update_owner on public.campaigns;
create policy campaigns_update_owner
  on public.campaigns for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists campaigns_delete_owner on public.campaigns;
create policy campaigns_delete_owner
  on public.campaigns for delete
  to authenticated
  using (owner_id = auth.uid());

-- Characters: anyone with the campaign UUID can read (overlay).
-- A player can only insert/update their own row.
-- A player can delete their own row, or the campaign owner can remove anyone.
drop policy if exists characters_select_anyone on public.characters;
create policy characters_select_anyone
  on public.characters for select
  using (true);

drop policy if exists characters_insert_self on public.characters;
create policy characters_insert_self
  on public.characters for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists characters_update_self on public.characters;
create policy characters_update_self
  on public.characters for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists characters_update_gm on public.characters;
create policy characters_update_gm
  on public.characters for update
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists characters_delete_self_or_owner on public.characters;
create policy characters_delete_self_or_owner
  on public.characters for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.owner_id = auth.uid()
    )
  );

-- ============================================================
-- character_gm_notes: GM-only private notes about each character
-- (Tier 5 DM workflow). Separate table because column-level RLS
-- isn't a thing; this keeps the notes truly GM-only against direct
-- API access.
-- ============================================================

create table if not exists public.character_gm_notes (
  character_id uuid primary key references public.characters(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function public.touch_gm_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gm_notes_touch on public.character_gm_notes;
create trigger gm_notes_touch
before update on public.character_gm_notes
for each row execute function public.touch_gm_notes_updated_at();

alter table public.character_gm_notes enable row level security;

drop policy if exists gm_notes_owner_all on public.character_gm_notes;
create policy gm_notes_owner_all
  on public.character_gm_notes for all
  to authenticated
  using (
    exists (
      select 1 from public.characters ch
      join public.campaigns cm on cm.id = ch.campaign_id
      where ch.id = character_gm_notes.character_id
        and cm.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.characters ch
      join public.campaigns cm on cm.id = ch.campaign_id
      where ch.id = character_gm_notes.character_id
        and cm.owner_id = auth.uid()
    )
  );

-- ============================================================
-- campaign_tokens: per-campaign API tokens for the VTT webhook
-- endpoint. Separate table so the token isn't reachable via the
-- public-select campaigns row.
-- ============================================================

create table if not exists public.campaign_tokens (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

alter table public.campaign_tokens enable row level security;

drop policy if exists campaign_tokens_owner on public.campaign_tokens;
create policy campaign_tokens_owner
  on public.campaign_tokens for all
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_tokens.campaign_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_tokens.campaign_id and c.owner_id = auth.uid()
    )
  );

create or replace function public.create_campaign_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.campaign_tokens(campaign_id) values (new.id)
  on conflict (campaign_id) do nothing;
  return new;
end;
$$;

drop trigger if exists campaigns_create_token on public.campaigns;
create trigger campaigns_create_token
after insert on public.campaigns
for each row execute function public.create_campaign_token();

-- ============================================================
-- Realtime
-- ============================================================

-- Enable realtime broadcasting on the characters table.
-- (Safe to skip if it's already in the publication.)
do $$
begin
  perform 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'characters';
  if not found then
    execute 'alter publication supabase_realtime add table public.characters';
  end if;
end$$;

do $$
begin
  perform 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns';
  if not found then
    execute 'alter publication supabase_realtime add table public.campaigns';
  end if;
end$$;
