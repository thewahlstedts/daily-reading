-- Daily reading reminders: one row per device that turned them on.
-- The `remind` Edge Function reads these with the service role and sends Web Push.
create table public.reminders (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  at_minute smallint not null check (at_minute between 0 and 1439), -- local time of day, in minutes
  tz text not null check (length(tz) <= 64),                          -- IANA time zone
  last_sent date,                                                     -- local date of the last reminder
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.reminders enable row level security;

revoke all on public.reminders from anon, authenticated;
grant select, insert, update, delete on public.reminders to authenticated;

create policy "Users can read their own reminders"
  on public.reminders for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own reminders"
  on public.reminders for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own reminders"
  on public.reminders for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own reminders"
  on public.reminders for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Sign-up is open, so cap devices per account: each row is a push the function sends.
-- (An upsert of an existing device fires this too, hence the endpoint check.)
create function public.reminders_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.reminders where user_id = new.user_id and endpoint <> new.endpoint) >= 10 then
    raise exception 'Too many reminder devices for this account';
  end if;
  return new;
end;
$$;

revoke execute on function public.reminders_limit() from public, anon, authenticated;

create trigger reminders_limit
  before insert on public.reminders
  for each row execute function public.reminders_limit();

-- Every 5 minutes, ask the function to send whatever is due. The shared secret
-- lives in Vault (created by hand, never in this file):
--   select vault.create_secret('<random>', 'reminder_cron_secret');
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://rnpuwanpgundhfmvzrne.supabase.co/functions/v1/remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
