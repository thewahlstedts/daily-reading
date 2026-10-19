-- Usage counts for the owner's dashboard (admin.html, through the `usage` function).
-- One row per device per UTC day it opened the live app. `device` is a random ID
-- the app keeps in localStorage; nothing else about the device (no IP, no browser)
-- is stored. `user_id` is set when it was signed in that day.
create table public.usage_days (
  day date not null default (now() at time zone 'utc')::date,
  device uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  standalone boolean not null default false, -- opened as the installed (home-screen) app
  primary key (day, device)
);

create index usage_days_user on public.usage_days (user_id);

-- Only the function writes (with the service role); people can see their own rows.
alter table public.usage_days enable row level security;
revoke all on public.usage_days from anon, authenticated;
grant select on public.usage_days to authenticated;
grant select, insert, update, delete on public.usage_days to service_role;

create policy "Users can read their own usage"
  on public.usage_days for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Anyone can call the function with made-up device IDs, so cap rows per day to
-- bound how much a script could add. Far above what the group needs.
create function public.usage_days_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.usage_days where day = new.day) >= 5000 then
    raise exception 'Too many devices today';
  end if;
  return new;
end;
$$;

revoke execute on function public.usage_days_limit() from public, anon, authenticated;

create trigger usage_days_limit
  before insert on public.usage_days
  for each row execute function public.usage_days_limit();

-- Keep about 13 months.
select cron.schedule(
  'trim-usage-days',
  '23 4 * * *',
  $$ delete from public.usage_days where day < current_date - 400; $$
);
