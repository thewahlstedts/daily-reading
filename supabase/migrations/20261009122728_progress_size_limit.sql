-- Cap each user's synced data. A full year of checkmarks plus settings is
-- well under 16 KB; 64 KB leaves headroom while preventing abuse of open sign-up.
alter table public.progress
  add constraint progress_data_size check (pg_column_size(data) <= 65536),
  add constraint progress_data_is_object check (jsonb_typeof(data) = 'object');
