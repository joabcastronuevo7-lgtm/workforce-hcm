-- PROPOSED, NOT APPLIED. Tested rolled back with supabase/tests/revoke_log_delete_test.sql. Narrows what the service role (secret key) can do to the reminder history and the
-- HRMS import audit log. The app only selects, inserts and updates these tables.
begin;

revoke delete, truncate, references, trigger on public.reminder_deliveries from service_role;
revoke delete, truncate, references, trigger on public.hrms_import_log from service_role;

-- The only change the app makes to a log entry is its outcome.
revoke update on public.hrms_import_log from service_role;
grant update (outcome) on public.hrms_import_log to service_role;

commit;

-- Unaffected: removing a shift assignment or employee still removes its reminder rows (foreign key cascade).
-- Not covered: the database owner (SQL editor, migrations) can still change anything.
