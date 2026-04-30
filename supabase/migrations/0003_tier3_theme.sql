-- RollCall — Tier 3 per-campaign overlay theme
-- Run after 0002_tier2_combat.sql. Safe to re-run.

alter table public.campaigns
  add column if not exists theme jsonb not null default '{}';

-- Realtime: when the GM saves theme changes, OBS overlays should pick them
-- up live. Add campaigns to the realtime publication if not already present.
do $$
begin
  perform 1 from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaigns';
  if not found then
    execute 'alter publication supabase_realtime add table public.campaigns';
  end if;
end$$;
