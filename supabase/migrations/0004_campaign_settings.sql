-- RollCall — campaign settings JSONB
-- Run after 0003_tier3_theme.sql. Safe to re-run.

alter table public.campaigns
  add column if not exists settings jsonb not null default '{}';

-- campaigns is already in the supabase_realtime publication (from 0003) so
-- settings changes push live to player sheets.
