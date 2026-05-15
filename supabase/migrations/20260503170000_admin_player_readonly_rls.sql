create schema if not exists app_private;

create table if not exists public.fm_profiles (
    id uuid primary key default gen_random_uuid(),
    auth_id uuid unique references auth.users(id) on delete cascade,
    username text not null unique,
    full_name text,
    email text unique,
    role text not null default 'player' check (role in ('admin', 'player')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.fm_matches (
    id text primary key,
    date date not null,
    time text not null,
    location text not null,
    player_fee numeric(10, 2) not null default 0,
    notes text not null default '',
    status text not null default 'AGENDADA',
    players jsonb not null default '[]'::jsonb,
    votes jsonb not null default '{"best_player":[],"worst_player":[]}'::jsonb,
    financial_summary jsonb not null default '{"expenses":[]}'::jsonb,
    results_processed boolean not null default false,
    voting_deadline timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.fm_player_stats (
    username text primary key,
    status text not null check (status in ('DISCOUNT', 'PENALTY')),
    value numeric(10, 2) not null default 0,
    updated_at timestamptz not null default now()
);

create table if not exists public.fm_app_config (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

create table if not exists public.fm_activity_logs (
    id uuid primary key default gen_random_uuid(),
    username text not null,
    action text not null default 'login',
    timestamp timestamptz not null default now()
);

create or replace function app_private.is_fm_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.fm_profiles
        where auth_id = auth.uid()
          and role = 'admin'
    );
$$;

create or replace function app_private.has_fm_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.fm_profiles
        where role = 'admin'
    );
$$;

insert into public.fm_app_config (key, value)
values
    ('admin_whatsapp', '5591900000000'),
    ('whatsapp_group_link', 'https://chat.whatsapp.com/SEU_LINK_AQUI')
on conflict (key) do update set
    value = excluded.value,
    updated_at = now();

alter table public.fm_profiles enable row level security;
alter table public.fm_matches enable row level security;
alter table public.fm_player_stats enable row level security;
alter table public.fm_app_config enable row level security;
alter table public.fm_activity_logs enable row level security;

drop policy if exists "fm_profiles_read_all" on public.fm_profiles;
drop policy if exists "fm_profiles_admin_write" on public.fm_profiles;
drop policy if exists "fm_profiles_first_admin_insert" on public.fm_profiles;
drop policy if exists "fm_matches_read_all" on public.fm_matches;
drop policy if exists "fm_matches_admin_write" on public.fm_matches;
drop policy if exists "fm_player_stats_read_all" on public.fm_player_stats;
drop policy if exists "fm_player_stats_admin_write" on public.fm_player_stats;
drop policy if exists "fm_app_config_read_all" on public.fm_app_config;
drop policy if exists "fm_app_config_admin_write" on public.fm_app_config;
drop policy if exists "fm_activity_logs_read_all" on public.fm_activity_logs;
drop policy if exists "fm_activity_logs_admin_write" on public.fm_activity_logs;

create policy "fm_profiles_read_all"
on public.fm_profiles for select
to anon, authenticated
using (true);

create policy "fm_profiles_admin_write"
on public.fm_profiles for all
to authenticated
using (app_private.is_fm_admin())
with check (app_private.is_fm_admin());

create policy "fm_profiles_first_admin_insert"
on public.fm_profiles for insert
to authenticated
with check (
    role = 'admin'
    and auth_id = auth.uid()
    and not app_private.has_fm_admin()
);

create policy "fm_matches_read_all"
on public.fm_matches for select
to anon, authenticated
using (true);

create policy "fm_matches_admin_write"
on public.fm_matches for all
to authenticated
using (app_private.is_fm_admin())
with check (app_private.is_fm_admin());

create policy "fm_player_stats_read_all"
on public.fm_player_stats for select
to anon, authenticated
using (true);

create policy "fm_player_stats_admin_write"
on public.fm_player_stats for all
to authenticated
using (app_private.is_fm_admin())
with check (app_private.is_fm_admin());

create policy "fm_app_config_read_all"
on public.fm_app_config for select
to anon, authenticated
using (true);

create policy "fm_app_config_admin_write"
on public.fm_app_config for all
to authenticated
using (app_private.is_fm_admin())
with check (app_private.is_fm_admin());

create policy "fm_activity_logs_read_all"
on public.fm_activity_logs for select
to anon, authenticated
using (true);

create policy "fm_activity_logs_admin_write"
on public.fm_activity_logs for all
to authenticated
using (app_private.is_fm_admin())
with check (app_private.is_fm_admin());

grant usage on schema public to anon, authenticated;
grant select on public.fm_profiles to anon, authenticated;
grant select on public.fm_matches to anon, authenticated;
grant select on public.fm_player_stats to anon, authenticated;
grant select on public.fm_app_config to anon, authenticated;
grant select on public.fm_activity_logs to anon, authenticated;
grant insert, update, delete on public.fm_profiles to authenticated;
grant insert, update, delete on public.fm_matches to authenticated;
grant insert, update, delete on public.fm_player_stats to authenticated;
grant insert, update, delete on public.fm_app_config to authenticated;
grant insert, update, delete on public.fm_activity_logs to authenticated;
