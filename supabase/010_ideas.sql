-- MOONRUSH ideas: players send what the game needs, should change or could lose (Help > Share an idea); only admins
-- read them (Admin > Ideas). They live in the bug_reports table, told apart by `kind`, so the same rules guard both:
-- anybody may add one, only admins read, mark and delete, and the flood stop counts them together.
-- Run supabase/009_bug_reports.sql first. Paste into Supabase > SQL Editor and Run. Safe to run again.

alter table public.bug_reports add column if not exists kind text not null default 'bug';

alter table public.bug_reports drop constraint if exists bug_reports_kind;
alter table public.bug_reports add constraint bug_reports_kind check (kind in ('bug', 'idea'));

create index if not exists bug_reports_kind_created on public.bug_reports (kind, created_at desc);
