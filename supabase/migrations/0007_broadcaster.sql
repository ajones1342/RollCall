-- RollCall — Twitch broadcaster channel link
-- Run after 0006_vtt_tokens.sql. Safe to re-run.

-- Per-campaign Twitch broadcaster credentials. Separate from the GM auth
-- (Supabase Twitch OAuth) so the GM account and the broadcast channel
-- don't have to be the same Twitch user.

create table if not exists public.campaign_broadcasters (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  broadcaster_id text not null,
  broadcaster_login text not null,
  broadcaster_display_name text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scopes text[] not null default '{}',
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_broadcaster_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaign_broadcasters_touch on public.campaign_broadcasters;
create trigger campaign_broadcasters_touch
before update on public.campaign_broadcasters
for each row execute function public.touch_broadcaster_updated_at();

alter table public.campaign_broadcasters enable row level security;

drop policy if exists campaign_broadcasters_owner on public.campaign_broadcasters;
create policy campaign_broadcasters_owner
  on public.campaign_broadcasters for all
  to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_broadcasters.campaign_id
        and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_broadcasters.campaign_id
        and c.owner_id = auth.uid()
    )
  );
