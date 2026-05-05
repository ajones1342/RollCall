-- RollCall — Co-GM support
-- Run after 0007_broadcaster.sql. Safe to re-run.
--
-- Adds a campaign_co_gms table and an is_campaign_gm() helper, then
-- updates RLS on every gated table to allow co-GMs alongside the campaign
-- owner. Owner-only gates (delete campaign, regenerate VTT token, manage
-- broadcaster) stay restricted.

-- ============================================================
-- Table: campaign_co_gms
-- ============================================================

create table if not exists public.campaign_co_gms (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  twitch_display_name text,
  invited_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

alter table public.campaign_co_gms enable row level security;

-- Owner can manage co-GM list (add/remove anyone).
drop policy if exists co_gms_owner_manage on public.campaign_co_gms;
create policy co_gms_owner_manage
  on public.campaign_co_gms for all
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_co_gms.campaign_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_co_gms.campaign_id and c.owner_id = auth.uid()
    )
  );

-- Self-read: a user can see their own co-GM rows so the dashboard can
-- list campaigns they're a co-GM on.
drop policy if exists co_gms_self_read on public.campaign_co_gms;
create policy co_gms_self_read
  on public.campaign_co_gms for select
  to authenticated
  using (user_id = auth.uid());

-- Self-insert: a user joining a co-GM invite link adds their own row.
-- Same security model as player join: anyone with the campaign UUID can
-- become a co-GM. The owner can remove unwanted co-GMs.
drop policy if exists co_gms_self_insert on public.campaign_co_gms;
create policy co_gms_self_insert
  on public.campaign_co_gms for insert
  to authenticated
  with check (user_id = auth.uid());

-- Self-delete: a co-GM can remove themselves (leave a campaign).
drop policy if exists co_gms_self_delete on public.campaign_co_gms;
create policy co_gms_self_delete
  on public.campaign_co_gms for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- Helper: is_campaign_gm(campaign_id) — owner OR co-GM.
-- Used in RLS policies that gate GM-level actions.
-- ============================================================

create or replace function public.is_campaign_gm(cid uuid)
returns boolean
language sql stable
as $$
  select coalesce(
    (select c.owner_id = auth.uid()
       from public.campaigns c where c.id = cid),
    false
  ) or exists (
    select 1 from public.campaign_co_gms g
    where g.campaign_id = cid and g.user_id = auth.uid()
  );
$$;

-- ============================================================
-- Update RLS on existing tables to allow co-GMs
-- ============================================================

-- campaigns: owner OR co-GM can update settings/theme. Delete stays owner-only.
drop policy if exists campaigns_update_owner on public.campaigns;
create policy campaigns_update_owner
  on public.campaigns for update
  to authenticated
  using (public.is_campaign_gm(id))
  with check (public.is_campaign_gm(id));

-- characters: GM-level update (any character in their campaign).
drop policy if exists characters_update_gm on public.characters;
create policy characters_update_gm
  on public.characters for update
  to authenticated
  using (public.is_campaign_gm(campaign_id))
  with check (public.is_campaign_gm(campaign_id));

drop policy if exists characters_delete_self_or_owner on public.characters;
create policy characters_delete_self_or_owner
  on public.characters for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_campaign_gm(campaign_id)
  );

-- character_gm_notes: any GM can read+write GM-only notes.
drop policy if exists gm_notes_owner_all on public.character_gm_notes;
create policy gm_notes_owner_all
  on public.character_gm_notes for all
  to authenticated
  using (
    exists (
      select 1 from public.characters ch
      where ch.id = character_gm_notes.character_id
        and public.is_campaign_gm(ch.campaign_id)
    )
  )
  with check (
    exists (
      select 1 from public.characters ch
      where ch.id = character_gm_notes.character_id
        and public.is_campaign_gm(ch.campaign_id)
    )
  );

-- campaign_tokens: any GM can read (so co-GMs see the VTT token), but
-- only the owner can mutate (regenerate).
drop policy if exists campaign_tokens_owner on public.campaign_tokens;
drop policy if exists campaign_tokens_select on public.campaign_tokens;
drop policy if exists campaign_tokens_owner_modify on public.campaign_tokens;

create policy campaign_tokens_select
  on public.campaign_tokens for select
  to authenticated
  using (public.is_campaign_gm(campaign_id));

create policy campaign_tokens_owner_modify
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

-- campaign_broadcasters: any GM can read (status display), only the
-- owner can connect / refresh / disconnect (sensitive — Twitch token).
drop policy if exists campaign_broadcasters_owner on public.campaign_broadcasters;
drop policy if exists campaign_broadcasters_select on public.campaign_broadcasters;
drop policy if exists campaign_broadcasters_owner_modify on public.campaign_broadcasters;

create policy campaign_broadcasters_select
  on public.campaign_broadcasters for select
  to authenticated
  using (public.is_campaign_gm(campaign_id));

create policy campaign_broadcasters_owner_modify
  on public.campaign_broadcasters for all
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_broadcasters.campaign_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_broadcasters.campaign_id and c.owner_id = auth.uid()
    )
  );
