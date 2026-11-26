-- Rolled-back test for the brief_gaps migration. Run the migration text and then this block as ONE query, before the
-- migration is applied. It ends with "raise exception", so nothing (columns, tables, fixtures) is kept.
do $test$
declare
  r jsonb := '{}';
  u1 uuid := gen_random_uuid(); e1 uuid := gen_random_uuid(); dept uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();
  admin_uid uuid; before_hash text; n int;
begin
  select md5(string_agg((to_jsonb(e) - 'location')::text, '|' order by e.id)) into before_hash from public.employees e;
  r := r || jsonb_build_object('01_existing_locations_all_null', (select count(*) = 0 from public.employees where location is not null));
  select id into admin_uid from public.profiles where role = 'admin' limit 1;
  insert into auth.users (id, instance_id, aud, role, email) values
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gap-test@example.invalid');
  insert into public.departments (id, name) values (dept, 'Gap test department');
  insert into public.employees (id, profile_id, employee_code, first_name, last_name, email, external_ref)
    values (e1, u1, 'TEST-GAP-1', 'Test', 'Gap', 'gap-test@example.invalid', 'GAP-1');
  insert into public.shifts (id, department_id, title, starts_at, ends_at, status) values
    (s1, dept, 'gap morning', now() + interval '20 hours', now() + interval '23 hours', 'published'),
    (s2, dept, 'gap evening', now() + interval '24 hours', now() + interval '27 hours', 'published'),
    (s3, dept, 'gap draft',   now() + interval '30 hours', now() + interval '33 hours', 'draft');
  insert into public.shift_assignments (id, shift_id, employee_id) values (a1, s1, e1), (a2, s2, e1), (a3, s3, e1);

  begin update public.employees set location = '   ' where id = e1; r := r || '{"02_blank_location_rejected": false}';
  exception when check_violation then r := r || '{"02_blank_location_rejected": true}'; end;

  r := r || jsonb_build_object('03_claim_service_role_only',
    has_function_privilege('service_role', 'public.claim_reminders(uuid[],text)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_reminders(uuid[],text)', 'execute')
    and not has_function_privilege('anon', 'public.claim_reminders(uuid[],text)', 'execute'));

  perform set_config('role', 'service_role', true);
  select count(*) into n from public.claim_reminders(array[a1, a2, a3], 'scheduled');
  r := r || jsonb_build_object('04_two_same_day_shifts_claimed_draft_not', n);
  select count(*) into n from public.claim_reminders(array[a1, a2], 'manual');
  r := r || jsonb_build_object('05_claim_while_sending', n);
  update public.reminder_deliveries set status = 'sent' where shift_assignment_id = a1;
  update public.reminder_deliveries set status = 'unknown' where shift_assignment_id = a2;
  select count(*) into n from public.claim_reminders(array[a1, a2], 'manual');
  r := r || jsonb_build_object('06_sent_or_unknown_claimed', n);
  update public.reminder_deliveries set status = 'failed' where shift_assignment_id = a1;
  select count(*) into n from public.claim_reminders(array[a1], 'scheduled');
  r := r || jsonb_build_object('07_failed_attempt_2', n);
  update public.reminder_deliveries set status = 'failed' where shift_assignment_id = a1;
  select count(*) into n from public.claim_reminders(array[a1], 'scheduled');
  r := r || jsonb_build_object('08_failed_attempt_3', n);
  update public.reminder_deliveries set status = 'failed' where shift_assignment_id = a1;
  select count(*) into n from public.claim_reminders(array[a1], 'scheduled');
  r := r || jsonb_build_object('09_fourth_attempt', n);
  update public.reminder_deliveries set status = 'not_linked', attempts = 0 where shift_assignment_id = a2;
  select count(*) into n from public.claim_reminders(array[a2], 'scheduled');
  r := r || jsonb_build_object('10_not_linked_claimable', n);

  perform set_config('role', 'none', true);
  update public.shifts set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = s1;
  perform set_config('role', 'service_role', true);
  select count(*) into n from public.claim_reminders(array[a1], 'scheduled');
  r := r || jsonb_build_object('11_rescheduled_shift_claimable', n);

  -- The import's write: an upsert on the HRMS id keeps the login link.
  insert into public.employees (employee_code, first_name, last_name, email, external_ref, location)
  values ('TEST-GAP-1', 'Renamed', 'Gap', 'gap-test@example.invalid', 'GAP-1', 'Test City')
  on conflict (external_ref) do update set first_name = excluded.first_name, location = excluded.location;
  r := r || jsonb_build_object('12_upsert_keeps_login', (select profile_id = u1 and first_name = 'Renamed' from public.employees where id = e1));
  insert into public.hrms_import_log (mode, outcome, total) values ('preview', 'previewed', 1);
  r := r || '{"13_service_writes_log": true}';

  -- Ordinary employee.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  r := r || jsonb_build_object('14_employee_sees_no_deliveries', (select count(*) = 0 from public.reminder_deliveries),
                               '15_employee_sees_no_import_log', (select count(*) = 0 from public.hrms_import_log));
  begin
    insert into public.reminder_deliveries (shift_assignment_id, shift_starts_at, employee_id, status, source) values (a3, now(), e1, 'sent', 'manual');
    r := r || '{"16_employee_insert_delivery_denied": false}';
  exception when insufficient_privilege then r := r || '{"16_employee_insert_delivery_denied": true}'; end;
  begin
    insert into public.hrms_import_log (mode, outcome, total) values ('apply', 'applied', 0);
    r := r || '{"17_employee_insert_log_denied": false}';
  exception when insufficient_privilege then r := r || '{"17_employee_insert_log_denied": true}'; end;
  begin perform public.claim_reminders(array[a1], 'manual'); r := r || '{"18_employee_claim_denied": false}';
  exception when insufficient_privilege then r := r || '{"18_employee_claim_denied": true}'; end;
  update public.employees set location = 'Hacked' where id = e1; get diagnostics n = row_count;
  r := r || jsonb_build_object('19_employee_location_update_rows', n);

  -- Administrator reads the records but cannot write them.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('20_admin_reads_deliveries', (select count(*) > 0 from public.reminder_deliveries),
                               '21_admin_reads_log', (select count(*) > 0 from public.hrms_import_log));
  begin update public.hrms_import_log set outcome = 'applied'; r := r || '{"22_admin_cannot_alter_log": false}';
  exception when insufficient_privilege then r := r || '{"22_admin_cannot_alter_log": true}'; end;
  update public.employees set location = 'Test City 2' where id = e1; get diagnostics n = row_count;
  r := r || jsonb_build_object('23_admin_location_update_rows', n);

  perform set_config('role', 'anon', true);
  begin perform count(*) from public.reminder_deliveries; r := r || '{"24_anon_denied": false}';
  exception when insufficient_privilege then r := r || '{"24_anon_denied": true}'; end;

  perform set_config('role', 'none', true);
  r := r || jsonb_build_object('25_existing_employees_unchanged',
    before_hash = (select md5(string_agg((to_jsonb(e) - 'location')::text, '|' order by e.id)) from public.employees e where e.id <> e1));
  raise exception 'ROLLED_BACK_TEST_RESULTS %', r::text;
end $test$;
