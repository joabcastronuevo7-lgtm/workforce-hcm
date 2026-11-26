-- Business units by geography, scheduled reminder tracking and the HRMS import audit log.
-- Additive: no existing table policy, grant or row is changed.

-- Geography. NULL until an administrator records a real location.
alter table public.employees
  add column location text check (location is null or length(trim(location)) between 1 and 60);
create index employees_location_idx on public.employees (location);

-- One reminder per assignment and start time: two shifts on one day are tracked separately, and a rescheduled shift
-- can be reminded again.
create table public.reminder_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  shift_assignment_id uuid not null references public.shift_assignments (id) on delete cascade,
  shift_starts_at     timestamptz not null,
  employee_id         uuid not null references public.employees (id) on delete cascade,
  status              text not null check (status in ('sending', 'sent', 'not_linked', 'failed', 'unknown')),
  attempts            smallint not null default 1 check (attempts >= 0),
  source              text not null check (source in ('scheduled', 'manual')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (shift_assignment_id, shift_starts_at)
);
create index reminder_deliveries_starts_idx on public.reminder_deliveries (shift_starts_at desc);
create index reminder_deliveries_employee_idx on public.reminder_deliveries (employee_id);
create trigger set_updated_at before update on public.reminder_deliveries
  for each row execute function private.set_updated_at();

alter table public.reminder_deliveries enable row level security;
revoke all on public.reminder_deliveries from anon, authenticated;
grant select on public.reminder_deliveries to authenticated;
grant select, insert, update on public.reminder_deliveries to service_role;
create policy reminder_deliveries_select on public.reminder_deliveries
  for select to authenticated using ((select private.is_admin()));

-- Atomically claims the reminders that may be sent now. A row already 'sending', 'sent' or 'unknown' is never returned,
-- so a message that may have arrived is not sent again. Only a refusal by Telegram is retried (three attempts), and a
-- person who was not linked can be claimed again once they are.
create function public.claim_reminders(p_assignment_ids uuid[], p_source text)
returns setof public.reminder_deliveries
language sql security invoker set search_path = '' as $$
  insert into public.reminder_deliveries as d (shift_assignment_id, shift_starts_at, employee_id, status, source)
  select a.id, s.starts_at, a.employee_id, 'sending', p_source
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
   where a.id = any (p_assignment_ids) and s.status = 'published' and s.starts_at > now()
  on conflict (shift_assignment_id, shift_starts_at) do update
    set status = 'sending', attempts = d.attempts + 1, source = excluded.source
    where d.status = 'not_linked' or (d.status = 'failed' and d.attempts < 3)
  returning d.*;
$$;
revoke all on function public.claim_reminders(uuid[], text) from public, anon, authenticated;
grant execute on function public.claim_reminders(uuid[], text) to service_role;

-- Every HRMS import request that reached validation, preview or apply. HRMS ids and outcomes, no personal details.
create table public.hrms_import_log (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null check (mode in ('preview', 'apply')),
  outcome    text not null check (outcome in ('previewed', 'applying', 'applied', 'rejected', 'failed')),
  total      integer not null,
  created    integer not null default 0,
  updated    integer not null default 0,
  rejected   integer not null default 0,
  results    jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index hrms_import_log_created_idx on public.hrms_import_log (created_at desc);

alter table public.hrms_import_log enable row level security;
revoke all on public.hrms_import_log from anon, authenticated;
grant select on public.hrms_import_log to authenticated;
grant select, insert, update on public.hrms_import_log to service_role;
create policy hrms_import_log_select on public.hrms_import_log
  for select to authenticated using ((select private.is_admin()));
