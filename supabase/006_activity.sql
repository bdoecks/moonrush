-- MOONRUSH player counters: how long each signed-in player played each day, so the admin panel can show players per
-- day, time played, and how many come back. Run this once in the Supabase SQL editor.

create table if not exists public.activity (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default current_date,
  seconds integer not null default 0,        -- time with the game open that day
  world_seconds integer not null default 0,  -- the part spent in the World
  primary key (user_id, day)
);
alter table public.activity enable row level security;
-- Nobody reads or writes the table directly; everything goes through the two functions below.
revoke all on public.activity from anon, authenticated;

-- The game calls this every ~45 seconds while a signed-in player has it open. Capped per call so it can't be inflated.
create or replace function public.track_activity(secs integer, in_world boolean default false) returns void
language sql volatile security definer set search_path = public
as $$
  insert into public.activity (user_id, day, seconds, world_seconds)
  select auth.uid(), current_date, least(greatest(secs, 0), 120), case when in_world then least(greatest(secs, 0), 120) else 0 end
  where auth.uid() is not null
  on conflict (user_id, day) do update
    set seconds = activity.seconds + excluded.seconds, world_seconds = activity.world_seconds + excluded.world_seconds
$$;
revoke all on function public.track_activity(integer, boolean) from public, anon;
grant execute on function public.track_activity(integer, boolean) to authenticated;

-- One row per day for the admin panel (admins only: everyone else gets nothing back).
--   players        signed-in players who had the game open that day
--   new_accounts   accounts created that day
--   avg_minutes    average time played per player
--   world_players  how many of them were in the World
--   back_next_day  of that day's players, how many played again the next day
--   back_in_week   of that day's players, how many played again within 7 days
create or replace function public.activity_summary(days integer default 14)
returns table (day date, players bigint, new_accounts bigint, avg_minutes numeric, world_players bigint, back_next_day bigint, back_in_week bigint)
language sql stable security definer set search_path = public
as $$
  select d.day::date,
    (select count(*) from activity a where a.day = d.day::date),
    (select count(*) from profiles p where p.created_at::date = d.day::date),
    coalesce((select round(avg(a.seconds) / 60.0, 1) from activity a where a.day = d.day::date), 0),
    (select count(*) from activity a where a.day = d.day::date and a.world_seconds > 0),
    (select count(*) from activity a where a.day = d.day::date and exists (select 1 from activity b where b.user_id = a.user_id and b.day = d.day::date + 1)),
    (select count(*) from activity a where a.day = d.day::date and exists (select 1 from activity b where b.user_id = a.user_id and b.day > d.day::date and b.day <= d.day::date + 7))
  from generate_series(current_date - (greatest(least(days, 60), 1) - 1), current_date, interval '1 day') as d(day)
  where public.is_admin()
  order by d.day desc
$$;
revoke all on function public.activity_summary(integer) from public, anon;
grant execute on function public.activity_summary(integer) to authenticated;
