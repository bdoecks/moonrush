-- MOONRUSH email list: players who agreed (a box at sign-up, ticked unless they untick it; changeable in their
-- account window) to get emails about updates and events. Run this once in the Supabase SQL editor.

create table if not exists public.mailing_list (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null,
  subscribed boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.mailing_list enable row level security;
-- Nobody reads or writes the table directly; everything goes through the functions below.
revoke all on public.mailing_list from anon, authenticated;

-- A player turns their emails on or off (their email comes from their account, never from the game).
create or replace function public.set_mailing(subscribe boolean) returns void
language sql volatile security definer set search_path = public
as $$
  insert into mailing_list (user_id, email, subscribed, updated_at)
  select auth.uid(), u.email, subscribe, now() from auth.users u where u.id = auth.uid() and u.email is not null
  on conflict (user_id) do update set subscribed = excluded.subscribed, email = excluded.email, updated_at = now()
$$;
revoke all on function public.set_mailing(boolean) from public, anon;
grant execute on function public.set_mailing(boolean) to authenticated;

-- Is the signed-in player on the list? (null = never chose)
create or replace function public.mailing_status() returns boolean
language sql stable security definer set search_path = public
as $$ select subscribed from mailing_list where user_id = auth.uid() $$;
revoke all on function public.mailing_status() from public, anon;
grant execute on function public.mailing_status() to authenticated;

-- The list itself, for the admin page (admins only: everyone else gets nothing back).
create or replace function public.mailing_export() returns table (email text, username text, since timestamptz)
language sql stable security definer set search_path = public
as $$
  select m.email, p.username, m.updated_at from mailing_list m left join profiles p on p.id = m.user_id
  where m.subscribed and public.is_admin() order by m.updated_at desc
$$;
revoke all on function public.mailing_export() from public, anon;
grant execute on function public.mailing_export() to authenticated;
