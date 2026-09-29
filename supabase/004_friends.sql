-- MOONRUSH global leaderboard + friends. Paste into Supabase > SQL Editor and Run.

-- Which season a player's points belong to (the global board only counts this season's).
alter table public.profiles add column if not exists season int not null default 0;
create index if not exists profiles_season_rank on public.profiles (season, season_points desc);

-- Friends: a request row (you -> them, pending) that they accept.
create table if not exists public.friends (
  user_id uuid not null references auth.users on delete cascade,
  friend_id uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.friends enable row level security;
grant select, insert, update, delete on public.friends to authenticated;
drop policy if exists "see your friendships" on public.friends;
create policy "see your friendships" on public.friends for select to authenticated using (auth.uid() in (user_id, friend_id));
drop policy if exists "send a request" on public.friends;
create policy "send a request" on public.friends for insert to authenticated with check (auth.uid() = user_id and status = 'pending');
drop policy if exists "accept a request" on public.friends;
create policy "accept a request" on public.friends for update to authenticated using (auth.uid() = friend_id) with check (auth.uid() = friend_id and status = 'accepted');
drop policy if exists "remove a friendship" on public.friends;
create policy "remove a friendship" on public.friends for delete to authenticated using (auth.uid() in (user_id, friend_id));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.friends where status = 'accepted' and ((user_id = a and friend_id = b) or (user_id = b and friend_id = a))) $$;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- Presence: online / which room. Only you and your friends can see it (room codes stay private).
create table if not exists public.presence (
  user_id uuid primary key references auth.users on delete cascade,
  last_seen timestamptz not null default now(),
  room text
);
alter table public.presence enable row level security;
grant select, insert, update on public.presence to authenticated;
drop policy if exists "friends see presence" on public.presence;
create policy "friends see presence" on public.presence for select to authenticated using (auth.uid() = user_id or public.are_friends(auth.uid(), user_id));
drop policy if exists "set your presence" on public.presence;
create policy "set your presence" on public.presence for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update your presence" on public.presence;
create policy "update your presence" on public.presence for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Room invites between friends.
create table if not exists public.invites (
  id bigint generated always as identity primary key,
  from_id uuid not null references auth.users on delete cascade,
  to_id uuid not null references auth.users on delete cascade,
  room text not null check (room ~ '^[A-Z0-9]{5}$'),
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
grant select, insert, delete on public.invites to authenticated;
drop policy if exists "see your invites" on public.invites;
create policy "see your invites" on public.invites for select to authenticated using (auth.uid() in (from_id, to_id));
drop policy if exists "invite a friend" on public.invites;
create policy "invite a friend" on public.invites for insert to authenticated with check (auth.uid() = from_id and public.are_friends(from_id, to_id));
drop policy if exists "clear an invite" on public.invites;
create policy "clear an invite" on public.invites for delete to authenticated using (auth.uid() in (from_id, to_id));
