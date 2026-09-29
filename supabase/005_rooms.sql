-- MOONRUSH saved rooms: the game server saves each room here so a restart / update doesn't end your round.
-- No public access at all: only the server (with the secret key) can read or write it.
create table if not exists public.rooms (
  code text primary key,
  state jsonb not null,
  charts jsonb,
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
