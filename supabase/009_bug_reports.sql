-- MOONRUSH bug reports: anybody playing can send one (Help > Report a bug); only admins can read them
-- (Admin > Bug reports). Paste into Supabase > SQL Editor and Run. Safe to run again.

create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users on delete set null, -- null: sent by a guest
  username text,                                         -- as the game showed it (a guest's is whatever they typed)
  what text not null,                                    -- what went wrong
  doing text,                                            -- what they were doing when it happened
  context jsonb not null default '{}'::jsonb,            -- filled in by the game: page, mode, coin, browser, screen
  status text not null default 'open',                   -- open | fixed | wontfix
  note text                                              -- the admin's own note
);
create index if not exists bug_reports_created on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;
grant insert on public.bug_reports to anon, authenticated;
grant select, update, delete on public.bug_reports to authenticated;

-- Anybody may send one, as themselves (or as nobody), within sane sizes, and only as a new open report.
drop policy if exists "anyone reports a bug" on public.bug_reports;
create policy "anyone reports a bug" on public.bug_reports for insert to anon, authenticated
  with check (
    (user_id is null or user_id = auth.uid())
    and char_length(what) between 10 and 2000
    and (doing is null or char_length(doing) <= 1000)
    and (username is null or char_length(username) <= 40)
    and pg_column_size(context) <= 4000
    and status = 'open' and note is null
  );

-- Only admins read, mark and delete them. (A sender cannot read their own back: nothing here is public.)
drop policy if exists "admins read bug reports" on public.bug_reports;
create policy "admins read bug reports" on public.bug_reports for select to authenticated using (public.is_admin());
drop policy if exists "admins mark bug reports" on public.bug_reports;
create policy "admins mark bug reports" on public.bug_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete bug reports" on public.bug_reports;
create policy "admins delete bug reports" on public.bug_reports for delete to authenticated using (public.is_admin());

-- A flood stop: one account sends at most 20 a day, and guests all together at most 60 an hour.
create or replace function public.bug_report_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    if (select count(*) from public.bug_reports where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
      raise exception 'You have sent a lot of reports today. Thank you; try again tomorrow.';
    end if;
  elsif (select count(*) from public.bug_reports where user_id is null and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many reports from guests right now. Sign in, or try again later.';
  end if;
  return new;
end $$;
drop trigger if exists bug_report_limit on public.bug_reports;
create trigger bug_report_limit before insert on public.bug_reports for each row execute function public.bug_report_limit();
