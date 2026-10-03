-- MOONRUSH invite links: a new player who signs up through someone's link is tied to them, and once the new player
-- has really played (15 minutes with the game open) both get an in-game gift. Run this once in the Supabase SQL
-- editor. Needs 003_gifts.sql (the gifts) and 006_activity.sql (time played).
-- (The table is called "referrals": "invites" is already the room invites between friends.)

create table if not exists public.referrals (
  invitee uuid primary key references auth.users on delete cascade, -- a player can be invited once
  inviter uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz -- when the gifts were sent (null = the invitee hasn't played long enough yet)
);
create index if not exists referrals_inviter on public.referrals (inviter);
alter table public.referrals enable row level security;
-- Nobody reads or writes the table directly; everything goes through the functions below.
revoke all on public.referrals from anon, authenticated;

-- A new player accepts an invite: `code` is the inviter's username. Returns 'ok:<inviter>' or why not:
--   signin   not signed in            unknown  no such player          self     your own link
--   already  you were already invited old      your account isn't new  loop     that player was invited by you
create or replace function public.use_invite(code text) returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  host uuid;
  host_name text;
  born timestamptz;
begin
  if me is null then return 'signin'; end if;
  select id, username into host, host_name from profiles where lower(username) = lower(trim(code));
  if host is null then return 'unknown'; end if;
  if host = me then return 'self'; end if;
  if exists (select 1 from referrals where invitee = me) then return 'already'; end if;
  select created_at into born from profiles where id = me;
  if born is null or born < now() - interval '3 days' then return 'old'; end if; -- links are for new players
  if exists (select 1 from referrals where invitee = host and inviter = me) then return 'loop'; end if;
  insert into referrals (invitee, inviter) values (me, host);
  return 'ok:' || host_name;
end $$;
revoke all on function public.use_invite(text) from public, anon;
grant execute on function public.use_invite(text) to authenticated;

-- Pay out the ones that are ready: the invited player has played 15 minutes. The invitee gets $1,000 in-game; the
-- inviter gets $1,000 too, for their first 25 friends. Either of the two can trigger it; it pays once. Returns how
-- many were paid just now.
create or replace function public.claim_invite_rewards() returns integer
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  n integer := 0;
  r record;
  paid integer;
begin
  if me is null then return 0; end if;
  for r in
    select i.invitee, i.inviter from referrals i
    where i.rewarded_at is null and (i.invitee = me or i.inviter = me)
      and (select coalesce(sum(a.seconds), 0) from activity a where a.user_id = i.invitee) >= 900
    for update of i skip locked
  loop
    update referrals set rewarded_at = now() where invitee = r.invitee;
    insert into gifts (user_id, asset, amount) values (r.invitee, 'usd', 1000);
    select count(*) into paid from referrals where inviter = r.inviter and rewarded_at is not null;
    if paid <= 25 then insert into gifts (user_id, asset, amount) values (r.inviter, 'usd', 1000); end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.claim_invite_rewards() from public, anon;
grant execute on function public.claim_invite_rewards() to authenticated;

-- What the Invite page shows you: who invited you, how far along you are, and the friends you brought in.
create or replace function public.invite_status() returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'invited_by', (select p.username from referrals i join profiles p on p.id = i.inviter where i.invitee = auth.uid()),
    'my_minutes', (select least(15, coalesce(sum(a.seconds), 0) / 60) from activity a where a.user_id = auth.uid()),
    'my_rewarded', coalesce((select i.rewarded_at is not null from referrals i where i.invitee = auth.uid()), false),
    'friends', coalesce((
      select json_agg(json_build_object(
        'name', p.username, 'avatar', p.avatar, 'joined', i.created_at, 'rewarded', i.rewarded_at is not null,
        'minutes', (select least(15, coalesce(sum(a.seconds), 0) / 60) from activity a where a.user_id = i.invitee)
      ) order by i.created_at desc)
      from referrals i join profiles p on p.id = i.invitee where i.inviter = auth.uid()
    ), '[]'::json)
  )
$$;
revoke all on function public.invite_status() from public, anon;
grant execute on function public.invite_status() to authenticated;
