-- RollCall — table points (Klout / Inspiration-like grant points)
-- Run after 0008_co_gm.sql. Safe to re-run.
--
-- The column exists on every character regardless of whether the campaign
-- has the feature enabled — gating happens in code via
-- campaigns.settings.tablePoints.enabled. Cheap to leave at 0 for campaigns
-- that don't use it, and avoids a second migration if a campaign toggles
-- the feature on later.

alter table public.characters
  add column if not exists table_points int not null default 0;

-- Non-negative invariant. GMs subtract when a player spends a point;
-- preventing it from going below 0 catches off-by-one bugs in webhook
-- callers (streamer.bot redemptions, etc.) at the DB layer.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'characters_table_points_nonneg'
  ) then
    alter table public.characters
      add constraint characters_table_points_nonneg
      check (table_points >= 0);
  end if;
end$$;
