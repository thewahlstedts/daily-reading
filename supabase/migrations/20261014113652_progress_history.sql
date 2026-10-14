-- Earlier versions of each person's synced data, so a bad sync (a device
-- pushing stale or test data) can be undone for that one person:
--   select saved_at, data from public.progress_history where user_id = '<id>' order by saved_at desc;
-- Kept 30 days, at most one copy per half hour per person, 300 per person.
create table public.progress_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null check (pg_column_size(data) <= 65536),
  saved_at timestamptz not null default now()
);

create index progress_history_user_saved on public.progress_history (user_id, saved_at desc);

-- People can see their own history (for a future restore button); only the trigger writes it.
alter table public.progress_history enable row level security;
revoke all on public.progress_history from anon, authenticated;
grant select on public.progress_history to authenticated;

create policy "Users can read their own history"
  on public.progress_history for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- The trigger runs as the signed-in user, who can't insert into the history
-- table, so the function is SECURITY DEFINER; it lives outside the exposed
-- `public` schema so it can't be called through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.save_progress_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.data is distinct from new.data and not exists (
    select 1 from public.progress_history
    where user_id = old.user_id and saved_at > now() - interval '30 minutes'
  ) then
    insert into public.progress_history (user_id, data) values (old.user_id, old.data);
  end if;
  return new;
end;
$$;

revoke execute on function private.save_progress_history() from public, anon, authenticated;

create trigger progress_history
  before update on public.progress
  for each row execute function private.save_progress_history();

-- Daily cleanup.
select cron.schedule(
  'trim-progress-history',
  '17 4 * * *',
  $$
  delete from public.progress_history where saved_at < now() - interval '30 days';
  delete from public.progress_history h
    using (select id, row_number() over (partition by user_id order by saved_at desc) as n
           from public.progress_history) r
    where h.id = r.id and r.n > 300;
  $$
);
