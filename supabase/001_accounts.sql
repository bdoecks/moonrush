-- MOONRUSH accounts (Phase 1). Paste this whole file into Supabase > SQL Editor and click Run.

-- Public player card: name, avatar, level, season points. Anyone can read it; only you can change yours.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  avatar text not null default '🐸',
  level int not null default 1,
  season_points int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- Your private save: progress and settings, synced between devices. Only you can read or write it.
create table if not exists public.saves (
  user_id uuid primary key references auth.users on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  rewards jsonb,
  settings jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.saves enable row level security;

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select, insert, update on public.saves to authenticated;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
drop policy if exists "create your own profile" on public.profiles;
create policy "create your own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "edit your own profile" on public.profiles;
create policy "edit your own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "read your own save" on public.saves;
create policy "read your own save" on public.saves for select to authenticated using (auth.uid() = user_id);
drop policy if exists "create your own save" on public.saves;
create policy "create your own save" on public.saves for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "edit your own save" on public.saves;
create policy "edit your own save" on public.saves for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
