-- MOONRUSH gifts: currency an admin sends to a player; their game claims it into their round.
create table if not exists public.gifts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  asset text not null check (asset in ('usd', 'sol', 'bsc', 'hood')),
  amount numeric not null check (amount > 0 and amount < 1000000000),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists gifts_open on public.gifts (user_id) where claimed_at is null;
alter table public.gifts enable row level security;
grant select, insert on public.gifts to authenticated;
drop policy if exists "admins send gifts" on public.gifts;
create policy "admins send gifts" on public.gifts for insert to authenticated with check (public.is_admin());
drop policy if exists "see your gifts" on public.gifts;
create policy "see your gifts" on public.gifts for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- Players can't edit gifts; claiming marks them received and hands them over in one step (no double-claiming).
create or replace function public.claim_gifts() returns table (asset text, amount numeric)
language sql volatile security definer set search_path = public
as $$ update public.gifts set claimed_at = now() where user_id = auth.uid() and claimed_at is null returning asset, amount $$;
revoke all on function public.claim_gifts() from public, anon;
grant execute on function public.claim_gifts() to authenticated;
