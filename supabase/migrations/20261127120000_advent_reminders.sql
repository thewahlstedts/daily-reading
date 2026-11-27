-- Advent 2026 Reminders for the separate Advent app (github.com/thewahlstedts/bp-advent,
-- https://advent.thewahlstedts.com), which shares this Supabase project. Its Edge
-- Functions (advent-subscribe, advent-remind) live and deploy from that repo; only
-- the schema is here, because this project has one migration history.
--
-- No accounts: one row per device, written only by the advent-subscribe function
-- with the service role. Nothing else can read or write it.
create table public.advent_reminders (
  id bigint generated always as identity primary key,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  at_minute smallint not null check (at_minute between 0 and 1439), -- local time of day, in minutes
  tz text not null check (length(tz) <= 64),                          -- IANA time zone
  done_on date,                                                       -- local date the device last marked Done today
  last_sent date,                                                     -- local date of the last Reminder
  created_at timestamptz not null default now()
);

alter table public.advent_reminders enable row level security;
revoke all on public.advent_reminders from anon, authenticated;

-- Every 5 minutes during Advent, send whatever is due. Reuses the Vault secret
-- `reminder_cron_secret` that the daily-reading reminders use.
select cron.schedule(
  'send-advent-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://rnpuwanpgundhfmvzrne.supabase.co/functions/v1/advent-remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- After Christmas (Dec 27, once everywhere is past Dec 25), stop sending, clear the
-- table and remove both jobs. The advent-remind function also clears it from Dec 26.
select cron.schedule(
  'end-advent-reminders',
  '0 12 27 12 *',
  $$
  select cron.unschedule('send-advent-reminders');
  delete from public.advent_reminders;
  select cron.unschedule('end-advent-reminders');
  $$
);
