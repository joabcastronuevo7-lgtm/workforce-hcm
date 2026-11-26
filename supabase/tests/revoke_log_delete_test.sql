-- Rolled-back test for supabase/proposed/revoke_log_delete.sql. Run the proposal WITHOUT its begin/commit lines and then
-- this block as ONE query. It ends with "raise exception", so the privileges and fixtures are not kept.
do $test$
declare
  r jsonb := '{}';
  dept uuid := gen_random_uuid(); emp uuid := gen_random_uuid(); s uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  admin_uid uuid; log_id uuid; n int;
begin
  select id into admin_uid from public.profiles where role = 'admin' limit 1;
  insert into public.departments (id, name) values (dept, 'Revoke test department');
  insert into public.employees (id, employee_code, first_name, last_name, email) values (emp, 'TEST-REVOKE', 'Test', 'Revoke', 'revoke-test@example.invalid');
  insert into public.shifts (id, department_id, title, starts_at, ends_at, status) values (s, dept, 'revoke test', now() + interval '20 hours', now() + interval '23 hours', 'published');
  insert into public.shift_assignments (id, shift_id, employee_id) values (a, s, emp);

  perform set_config('role', 'service_role', true);
  select count(*) into n from public.claim_reminders(array[a], 'manual');
  r := r || jsonb_build_object('01_claim_inserts', n);
  update public.reminder_deliveries set status = 'failed' where shift_assignment_id = a;
  get diagnostics n = row_count; r := r || jsonb_build_object('02_delivery_update', n);
  select count(*) into n from public.claim_reminders(array[a], 'scheduled');
  r := r || jsonb_build_object('03_claim_retry_updates', n);
  update public.reminder_deliveries set status = 'not_linked', attempts = 0 where shift_assignment_id = a;
  get diagnostics n = row_count; r := r || jsonb_build_object('04_delivery_update_attempts', n);
  r := r || jsonb_build_object('05_delivery_select', (select count(*) from public.reminder_deliveries where shift_assignment_id = a));

  insert into public.hrms_import_log (mode, outcome, total, created, updated, rejected, results) values ('apply', 'applying', 1, 1, 0, 0, '[]') returning id into log_id;
  r := r || jsonb_build_object('06_log_insert_returning', log_id is not null);
  update public.hrms_import_log set outcome = 'applied' where id = log_id;
  get diagnostics n = row_count; r := r || jsonb_build_object('07_log_update_outcome', n);
  r := r || jsonb_build_object('08_log_select', (select count(*) from public.hrms_import_log where id = log_id));
  begin update public.hrms_import_log set results = '[1]' where id = log_id; r := r || '{"09_log_rewrite_denied": false}';
  exception when insufficient_privilege then r := r || '{"09_log_rewrite_denied": true}'; end;
  begin delete from public.hrms_import_log where id = log_id; r := r || '{"10_log_delete_denied": false}';
  exception when insufficient_privilege then r := r || '{"10_log_delete_denied": true}'; end;
  begin delete from public.reminder_deliveries where shift_assignment_id = a; r := r || '{"11_delivery_delete_denied": false}';
  exception when insufficient_privilege then r := r || '{"11_delivery_delete_denied": true}'; end;
  begin truncate public.hrms_import_log; r := r || '{"12_log_truncate_denied": false}';
  exception when insufficient_privilege then r := r || '{"12_log_truncate_denied": true}'; end;
  begin truncate public.reminder_deliveries; r := r || '{"13_delivery_truncate_denied": false}';
  exception when insufficient_privilege then r := r || '{"13_delivery_truncate_denied": true}'; end;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  r := r || jsonb_build_object('14_admin_reads_delivery', (select count(*) from public.reminder_deliveries where shift_assignment_id = a),
                               '15_admin_reads_log', (select count(*) from public.hrms_import_log where id = log_id));
  begin delete from public.hrms_import_log where id = log_id; r := r || '{"16_admin_delete_denied": false}';
  exception when insufficient_privilege then r := r || '{"16_admin_delete_denied": true}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('17_other_user_reads_nothing', (select count(*) from public.reminder_deliveries) + (select count(*) from public.hrms_import_log));

  perform set_config('role', 'service_role', true);
  delete from public.shift_assignments where id = a;
  perform set_config('role', 'none', true);
  r := r || jsonb_build_object('18_cascade_still_removes_delivery', (select count(*) = 0 from public.reminder_deliveries where shift_assignment_id = a));

  raise exception 'ROLLED_BACK_TEST_RESULTS %', r::text;
end $test$;
