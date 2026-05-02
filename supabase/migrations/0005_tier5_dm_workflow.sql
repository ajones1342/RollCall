-- RollCall — Tier 5 DM workflow extras
-- Run after 0004_campaign_settings.sql. Safe to re-run.

-- character_gm_notes: GM-only private notes about each character.
-- Lives in its own table (not as a column on characters) because RLS is
-- row-level — putting GM-only data in a row that's anon-readable would
-- leak it via direct API calls. A separate table with stricter RLS keeps
-- the notes truly GM-only.
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

-- Only the owning campaign's GM can read or write.
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
