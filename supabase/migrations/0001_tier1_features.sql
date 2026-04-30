-- RollCall — Tier 1 features migration
-- Run this in your Supabase SQL Editor on top of an existing project that
-- already has supabase/schema.sql applied. Safe to re-run.

-- ============================================================
-- 1. hidden_fields: per-character overlay visibility
-- ============================================================

alter table public.characters
  add column if not exists hidden_fields text[] not null default '{}';

-- ============================================================
-- 2. RLS: campaign owner (GM) can update any character in their campaign
-- ============================================================

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

-- The existing characters_update_self policy still applies — players can
-- update their own row, GMs can update any row in their campaigns.
-- Postgres OR-combines RLS policies, so both grants stack additively.
