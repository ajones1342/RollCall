-- RollCall — VTT webhook auth tokens
-- Run after 0005_tier5_dm_workflow.sql. Safe to re-run.

-- Per-campaign API tokens for the VTT webhook endpoint. In a separate table
-- so the token isn't readable via the public-select campaigns table — RLS
-- restricts read+write to the campaign owner.

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

-- Auto-create a token row whenever a new campaign is created.
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

-- Backfill tokens for existing campaigns that don't have one yet.
insert into public.campaign_tokens (campaign_id)
select id from public.campaigns
where id not in (select campaign_id from public.campaign_tokens)
on conflict (campaign_id) do nothing;
