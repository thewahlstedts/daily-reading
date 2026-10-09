-- One row per signed-in user holding their synced reading progress.
-- `data` mirrors the app's synced state: { start, read: { index: date }, translation, automark }.
create table public.progress (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

-- Only signed-in users, and only their own row. No access for anon.
revoke all on public.progress from anon, authenticated;
grant select, insert, update on public.progress to authenticated;

create policy "Users can read their own progress"
  on public.progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own progress"
  on public.progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own progress"
  on public.progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Server-side timestamp so devices can tell which copy is newer.
create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger progress_set_updated_at
  before update on public.progress
  for each row execute function public.set_updated_at();
