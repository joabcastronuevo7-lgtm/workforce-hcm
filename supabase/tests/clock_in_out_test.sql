-- Rolled-back test for the clock in/out migration. Run the migration text and then this block as ONE query,
-- before the migration is applied. It ends with "raise exception", so nothing (functions, index, fixtures) is kept.
do $test$
declare
  r jsonb := '{}';
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid();
  e2 uuid := gen_random_uuid();
  dept uuid := gen_random_uuid();
  admin_uid uuid;
  before_hash text;
  a_early uuid; a_over uuid; a_other uuid; a_draft uuid; a_ok uuid; a_second uuid; a_late uuid; a_grace uuid;
  n int;
  rec record;
begin
  select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) into before_hash from public.attendance_records t;
  select id into admin_uid from public.profiles where role = 'admin' limit 1;

  insert into auth.users (id, instance_id, aud, role, email) values
    (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clock-test-1@example.invalid'),
    (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'clock-test-2@example.invalid');
  insert into public.departments (id, name) values (dept, 'Clock test department');
  insert into public.employees (id, profile_id, employee_code, first_name, last_name, email) values
    (e1, u1, 'TEST-CLOCK-1', 'Test', 'One', 'clock-test-1@example.invalid'),
    (e2, u2, 'TEST-CLOCK-2', 'Test', 'Two', 'clock-test-2@example.invalid');

  create temp table fx (k text, a uuid) on commit drop;
  for rec in select * from (values
      ('early', e1, interval '45 minutes', interval '8 hours', 'published'),
      ('over',  e1, interval '-9 hours',   interval '-1 hour', 'published'),
      ('other', e2, interval '0',          interval '8 hours', 'published'),
      ('draft', e1, interval '0',          interval '8 hours', 'draft'),
      ('ok',    e1, interval '29 minutes', interval '8 hours', 'published'),
      ('second',e1, interval '10 minutes', interval '9 hours', 'published'),
      ('late',  e1, interval '-6 minutes', interval '7 hours', 'published'),
      ('grace', e1, interval '-4 minutes', interval '7 hours', 'published')
    ) v(k, emp, start_off, end_off, st)
  loop
    declare s uuid := gen_random_uuid(); a uuid := gen_random_uuid();
    begin
      insert into public.shifts (id, department_id, title, starts_at, ends_at, status)
      values (s, dept, 'Clock test ' || rec.k, now() + rec.start_off, now() + rec.end_off, rec.st::public.shift_status);
      insert into public.shift_assignments (id, shift_id, employee_id) values (a, s, rec.emp);
      insert into fx values (rec.k, a);
    end;
  end loop;
  select a into a_early from fx where k = 'early';   select a into a_over from fx where k = 'over';
  select a into a_other from fx where k = 'other';   select a into a_draft from fx where k = 'draft';
  select a into a_ok from fx where k = 'ok';         select a into a_second from fx where k = 'second';
  select a into a_late from fx where k = 'late';     select a into a_grace from fx where k = 'grace';

  r := r || jsonb_build_object(
    '01_anon_cannot_execute', not has_function_privilege('anon', 'public.clock_in(uuid)', 'execute')
                          and not has_function_privilege('anon', 'public.clock_out()', 'execute'),
    '02_authenticated_can_execute', has_function_privilege('authenticated', 'public.clock_in(uuid)', 'execute'));

  -- Employee one.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    insert into public.attendance_records (employee_id, work_date, clock_in) values (e1, current_date, now());
    r := r || '{"03_direct_insert_denied": false}';
  exception when insufficient_privilege then r := r || '{"03_direct_insert_denied": true}';
  end;

  begin perform public.clock_in(a_early);  r := r || '{"04_too_early": "ACCEPTED"}';  exception when raise_exception then r := r || jsonb_build_object('04_too_early', sqlerrm); end;
  begin perform public.clock_in(a_over);   r := r || '{"05_after_end": "ACCEPTED"}';  exception when raise_exception then r := r || jsonb_build_object('05_after_end', sqlerrm); end;
  begin perform public.clock_in(a_other);  r := r || '{"06_other_employee": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('06_other_employee', sqlerrm); end;
  begin perform public.clock_in(a_draft);  r := r || '{"07_draft_shift": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('07_draft_shift', sqlerrm); end;
  begin perform public.clock_out();        r := r || '{"08_out_before_in": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('08_out_before_in', sqlerrm); end;

  perform public.clock_in(a_ok);
  select status, clock_in, clock_out, work_date, employee_id into rec from public.attendance_records where shift_assignment_id = a_ok;
  r := r || jsonb_build_object('09_in_29min_early', rec.status, '10_own_row_db_time', rec.employee_id = e1 and rec.clock_in >= now() and rec.clock_out is null,
    '11_work_date_is_manila_shift_date', rec.work_date = ((now() + interval '29 minutes') at time zone 'Asia/Manila')::date);

  begin perform public.clock_in(a_ok);     r := r || '{"12_same_shift_twice": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('12_same_shift_twice', sqlerrm); end;
  begin perform public.clock_in(a_second); r := r || '{"13_second_open_shift": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('13_second_open_shift', sqlerrm); end;

  update public.attendance_records set clock_in = clock_in - interval '2 hours', status = 'present' where shift_assignment_id = a_ok;
  get diagnostics n = row_count;
  r := r || jsonb_build_object('14_direct_update_rows', n);
  delete from public.attendance_records where shift_assignment_id = a_ok;
  get diagnostics n = row_count;
  r := r || jsonb_build_object('15_direct_delete_rows', n);

  perform public.clock_out();
  select clock_in, clock_out into rec from public.attendance_records where shift_assignment_id = a_ok;
  r := r || jsonb_build_object('16_clock_out_ok', rec.clock_out > rec.clock_in);
  begin perform public.clock_out();        r := r || '{"17_out_twice": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('17_out_twice', sqlerrm); end;
  begin perform public.clock_in(a_ok);     r := r || '{"18_reclock_closed_shift": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('18_reclock_closed_shift', sqlerrm); end;

  perform public.clock_in(a_late);
  r := r || jsonb_build_object('19_6min_after_start', (select status from public.attendance_records where shift_assignment_id = a_late));
  perform public.clock_out();
  perform public.clock_in(a_grace);
  r := r || jsonb_build_object('20_4min_after_start', (select status from public.attendance_records where shift_assignment_id = a_grace));

  -- Age the open record past 24 hours (as the database owner): it must neither close nor block.
  perform set_config('role', 'none', true);
  update public.attendance_records set clock_in = now() - interval '25 hours' where shift_assignment_id = a_grace;
  perform set_config('role', 'authenticated', true);
  begin perform public.clock_out();        r := r || '{"21_stale_not_closed": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('21_stale_not_closed', sqlerrm); end;
  perform public.clock_in(a_second);
  r := r || '{"22_stale_does_not_block": true}';

  r := r || jsonb_build_object('23_employee_sees_only_own', (select count(*) filter (where employee_id <> e1) = 0 and count(*) = 4 from public.attendance_records));

  -- Employee two cannot see or close employee one's open record.
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('24_other_sees_none', (select count(*) = 0 from public.attendance_records));
  begin perform public.clock_out();        r := r || '{"25_other_cannot_close": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('25_other_cannot_close', sqlerrm); end;

  -- A signed-in user with no employee record.
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin perform public.clock_in(a_second); r := r || '{"26_unlinked_user": "ACCEPTED"}'; exception when raise_exception then r := r || jsonb_build_object('26_unlinked_user', sqlerrm); end;

  -- Administrator sees the new records.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('27_admin_sees_new_records', (select count(*) = 4 from public.attendance_records where employee_id = e1));

  perform set_config('role', 'none', true);
  r := r || jsonb_build_object('28_existing_records_unchanged',
    before_hash = (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.attendance_records t where t.employee_id not in (e1, e2)));

  raise exception 'ROLLED_BACK_TEST_RESULTS %', r::text;
end $test$;
