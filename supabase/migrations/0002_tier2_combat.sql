-- RollCall — Tier 2 combat clarity migration
-- Run after 0001_tier1_features.sql. Safe to re-run.

alter table public.characters
  add column if not exists temp_hp int not null default 0,
  add column if not exists conditions text[] not null default '{}',
  add column if not exists death_save_successes int not null default 0,
  add column if not exists death_save_failures int not null default 0,
  add column if not exists inspiration boolean not null default false,
  add column if not exists notes text not null default '';

-- Constrain death-save counts to 0..3 to match 5e rules.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'characters_death_save_successes_range'
  ) then
    alter table public.characters
      add constraint characters_death_save_successes_range
      check (death_save_successes between 0 and 3);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'characters_death_save_failures_range'
  ) then
    alter table public.characters
      add constraint characters_death_save_failures_range
      check (death_save_failures between 0 and 3);
  end if;
end$$;
