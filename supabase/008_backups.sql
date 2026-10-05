-- MOONRUSH backups: once a day the game server stores a copy of the World (wallets, coins, charts) and of the account
-- tables here, and keeps a week of daily copies plus a month of weekly ones. Admins can download a copy or put a World
-- copy back from the admin panel (Switches & stats → Backups).
-- Each copy is one row: the data is JSON, gzipped, as base64 text (a few hundred KB to a couple of MB).
-- No public access at all: only the server (with the secret key) can read or write it.
create table if not exists public.backups (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('world', 'accounts')),
  taken_at timestamptz not null default now(),
  bytes bigint not null default 0, -- size before squeezing
  note text,
  data text not null
);
create index if not exists backups_kind_taken_at on public.backups (kind, taken_at desc);
alter table public.backups enable row level security;
revoke all on public.backups from anon, authenticated;
