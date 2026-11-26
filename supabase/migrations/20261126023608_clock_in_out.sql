-- Employee clock in/out. Sessions keep no direct write access to attendance_records (the admin-only RLS
-- policies are unchanged); these two functions are the only way an employee writes, always to their own rows,
-- with times set by the database.

-- One attendance record per shift assignment.
create unique index attendance_records_assignment_unique
  on public.attendance_records (shift_assignment_id)
  where shift_assignment_id is not null;

-- From 30 minutes before the start until the shift ends. More than 5 minutes after the start is 'late'.
create function public.clock_in(p_assignment_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := private.current_employee_id();
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz;
begin
  -- Serialises this employee's clock-ins, so two requests at once cannot both pass the checks below.
  perform pg_advisory_xact_lock(hashtextextended('clock:' || coalesce(v_emp::text, ''), 0));
  v_now := clock_timestamp();

  select s.starts_at, s.ends_at into v_start, v_end
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
   where a.id = p_assignment_id and a.employee_id = v_emp and s.status = 'published';
  if not found then raise exception 'shift_not_found'; end if;
  if exists (select 1 from public.attendance_records where shift_assignment_id = p_assignment_id) then
    raise exception 'already_recorded';
  end if;
  if v_now < v_start - interval '30 minutes' or v_now >= v_end then
    raise exception 'outside_window';
  end if;
  if exists (select 1 from public.attendance_records
              where employee_id = v_emp and clock_in is not null and clock_out is null
                and clock_in > v_now - interval '24 hours') then
    raise exception 'already_clocked_in';
  end if;

  insert into public.attendance_records
    (employee_id, shift_assignment_id, work_date, clock_in, status)
  values
    (v_emp, p_assignment_id, (v_start at time zone 'Asia/Manila')::date, v_now,
     (case when v_now > v_start + interval '5 minutes' then 'late' else 'present' end)::public.attendance_status);
  return v_now;
end $$;

-- Closes the caller's open record from the last 24 hours.
create function public.clock_out() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_out timestamptz;
begin
  update public.attendance_records set clock_out = clock_timestamp()
   where id = (select id from public.attendance_records
                where employee_id = private.current_employee_id()
                  and clock_in is not null and clock_out is null
                  and clock_in > clock_timestamp() - interval '24 hours'
                order by clock_in desc limit 1 for update)
     and clock_out is null
  returning clock_out into v_out;
  if v_out is null then raise exception 'not_clocked_in'; end if;
  return v_out;
end $$;

revoke all on function public.clock_in(uuid), public.clock_out() from public, anon;
grant execute on function public.clock_in(uuid), public.clock_out() to authenticated;
