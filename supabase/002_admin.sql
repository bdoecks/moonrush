-- MOONRUSH admin (only the accounts in `admins` get the admin panel). Paste into Supabase > SQL Editor and Run.

create table if not exists public.admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.admins enable row level security;
grant select on public.admins to authenticated;
drop policy if exists "see if you are admin" on public.admins;
create policy "see if you are admin" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
grant execute on function public.is_admin() to anon, authenticated;

-- You (bdoecks) are the admin.
insert into public.admins (user_id) values ('d1d4afaa-40cf-443e-a5c1-73d160b42eed') on conflict do nothing;

-- Banned accounts can't join rooms. Anyone can see the list; only admins change it.
create table if not exists public.bans (
  user_id uuid primary key references auth.users on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.bans enable row level security;
grant select on public.bans to anon, authenticated;
grant insert, delete on public.bans to authenticated;
drop policy if exists "bans are public" on public.bans;
create policy "bans are public" on public.bans for select using (true);
drop policy if exists "admins ban" on public.bans;
create policy "admins ban" on public.bans for insert to authenticated with check (public.is_admin());
drop policy if exists "admins unban" on public.bans;
create policy "admins unban" on public.bans for delete to authenticated using (public.is_admin());

-- Game switches everyone's game reads (events feed, pop-ups, multiplayer, notice banner). Only admins change them.
create table if not exists public.app_flags (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
grant select on public.app_flags to anon, authenticated;
grant insert, update on public.app_flags to authenticated;
drop policy if exists "flags are public" on public.app_flags;
create policy "flags are public" on public.app_flags for select using (true);
drop policy if exists "admins add flags" on public.app_flags;
create policy "admins add flags" on public.app_flags for insert to authenticated with check (public.is_admin());
drop policy if exists "admins change flags" on public.app_flags;
create policy "admins change flags" on public.app_flags for update to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.app_flags (key, value) values
  ('events', 'false'), ('eventPopups', 'false'), ('multiplayer', 'true'), ('notice', '""')
on conflict (key) do nothing;

-- Admins can see and edit everyone's save (give XP, reset progress). admin_rev tells the player's game to take it.
alter table public.saves add column if not exists admin_rev int not null default 0;
drop policy if exists "admins read saves" on public.saves;
create policy "admins read saves" on public.saves for select to authenticated using (public.is_admin());
drop policy if exists "admins edit saves" on public.saves;
create policy "admins edit saves" on public.saves for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins can fix anyone's public card (level, season points) when resetting or gifting.
drop policy if exists "admins edit profiles" on public.profiles;
create policy "admins edit profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
