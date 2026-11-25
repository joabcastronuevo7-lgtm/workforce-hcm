import type { Metadata } from "next";
import Link from "next/link";
import { RequireRole } from "@/components/app-shell";
import { FilterSheet } from "@/components/filter-sheet";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/placeholder";
import { Alert, Badge, EmptyState, buttonClass, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABELS, STATUS_TONES, TYPE_LABELS, formatDate, type EmployeeStatus } from "@/lib/labels";
import { isUuid, searchTerms } from "@/lib/validation";

export const metadata: Metadata = { title: "Employees" };

const PAGE_SIZE = 15;
const SORTS = {
  code: "employee_code",
  name: "last_name",
  type: "employment_type",
  status: "status",
  hired: "hire_date",
} as const;
type SortKey = keyof typeof SORTS;
type Params = Record<string, string | undefined>;

const SORT_LABELS: Record<SortKey, string> = { code: "Employee ID", name: "Last name", type: "Employment type", status: "Status", hired: "Hire date" };
const ACCOUNT_LABELS = { yes: "Has login", no: "No login" } as const;

export default function Page({ searchParams }: PageProps<"/admin/employees">) {
  return (
    <RequireRole role="admin">
      <PageHeader title="Employees" description="Search, filter and manage employee records and logins." />
      <EmployeeDirectory searchParams={searchParams} />
    </RequireRole>
  );
}

const initials = (first: string, last: string) => `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();

async function EmployeeDirectory({ searchParams }: { searchParams: PageProps<"/admin/employees">["searchParams"] }) {
  const raw = await searchParams;
  const params: Params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const q = (params.q ?? "").trim();
  const department = isUuid(params.department) ? params.department : "";
  const position = isUuid(params.position) ? params.position : "";
  const status = params.status && params.status in STATUS_LABELS ? (params.status as EmployeeStatus) : "";
  const account = params.account === "yes" || params.account === "no" ? params.account : "";
  const sort: SortKey = params.sort && params.sort in SORTS ? (params.sort as SortKey) : "code";
  const dir = params.dir === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("employees")
    .select(
      "id, employee_code, first_name, last_name, email, status, employment_type, hire_date, profile_id, department:departments(name), position:positions(title)",
      { count: "exact" },
    );
  for (const term of searchTerms(q)) {
    query = query.or(
      `first_name.ilike.*${term}*,last_name.ilike.*${term}*,employee_code.ilike.*${term}*,email.ilike.*${term}*`,
    );
  }
  if (department) query = query.eq("department_id", department);
  if (position) query = query.eq("position_id", position);
  if (status) query = query.eq("status", status);
  if (account === "yes") query = query.not("profile_id", "is", null);
  if (account === "no") query = query.is("profile_id", null);
  query = query.order(SORTS[sort], { ascending: dir === "asc" });
  if (sort === "name") query = query.order("first_name", { ascending: dir === "asc" });
  query = query.order("id").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data: employees, count, error }, { count: allCount }, { data: departments }, { data: positions }] = await Promise.all([
    query,
    supabase.from("employees").select("id", { count: "exact", head: true }),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title, department:departments(name)").order("title"),
  ]);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || department || position || status || account);

  const href = (overrides: Params) => {
    const next = new URLSearchParams();
    const merged = { q, department, position, status, account, sort, dir, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (!v || (k === "page" && v === "1") || (k === "sort" && v === "code") || (k === "dir" && v === "asc")) continue;
      next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `/admin/employees?${qs}` : "/admin/employees";
  };

  // Each active filter as a removable chip; removing one keeps the others and returns to page 1.
  const chips = [
    q && { key: "q", label: `“${q}”` },
    department && { key: "department", label: departments?.find((d) => d.id === department)?.name ?? "Department" },
    position && { key: "position", label: positions?.find((p) => p.id === position)?.title ?? "Position" },
    status && { key: "status", label: STATUS_LABELS[status] },
    account && { key: "account", label: ACCOUNT_LABELS[account] },
  ].filter((c): c is { key: string; label: string } => Boolean(c));
  const sheetFilters = chips.filter((c) => c.key !== "q").length;

  const sortHeader = (by: SortKey, children: string, extra = "") => {
    const active = sort === by;
    const nextDir = active && dir === "asc" ? "desc" : "asc";
    return (
      <th key={by} scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-3 text-left font-medium ${extra}`}>
        <Link href={href({ sort: by, dir: nextDir, page: "1" })} className="inline-flex items-center gap-1 hover:text-zinc-900">
          {children}
          <span aria-hidden className={active ? "text-zinc-700" : "text-zinc-300"}>
            {active && dir === "desc" ? "↓" : "↑"}
          </span>
        </Link>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <form action="/admin/employees" role="search" className="flex gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor="q" className="sr-only">
            Search employees
          </label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Search name, ID or email" className={inputClass} />
        </div>
        <FilterSheet
          active={sheetFilters}
          footer={
            <>
              <Link href={q ? `/admin/employees?q=${encodeURIComponent(q)}` : "/admin/employees"} className={buttonClass.secondary}>
                Clear
              </Link>
              <button type="submit" className={buttonClass.primary}>
                Show results
              </button>
            </>
          }
        >
          <FilterSelect name="department" label="Department" all="All departments" value={department}
            options={(departments ?? []).map((d) => [d.id, d.name])} />
          <FilterSelect name="position" label="Position" all="All positions" value={position}
            options={(positions ?? []).map((p) => [p.id, `${p.title} · ${p.department?.name ?? ""}`])} />
          <div className="grid grid-cols-2 gap-3">
            <FilterSelect name="status" label="Status" all="All statuses" value={status} options={Object.entries(STATUS_LABELS)} />
            <FilterSelect name="account" label="Login" all="Any" value={account} options={Object.entries(ACCOUNT_LABELS)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FilterSelect name="sort" label="Sort by" value={sort} options={Object.entries(SORT_LABELS)} />
            <FilterSelect name="dir" label="Order" value={dir} options={[["asc", "Ascending"], ["desc", "Descending"]]} />
          </div>
        </FilterSheet>
        {/* wrapped: `hidden` on the button itself would lose to the button's own inline-flex */}
        <div className="hidden lg:block">
          <button type="submit" className={buttonClass.secondary}>
            Search
          </button>
        </div>
        <div className="ml-auto hidden sm:block">
          <Link href="/admin/employees/new" className={buttonClass.primary}>
            <Icon name="plus" className="size-4" />
            Add employee
          </Link>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-zinc-600" aria-live="polite">
          {error ? null : filtered ? (
            <><span className="font-semibold text-zinc-900">{total}</span> of {allCount ?? total} employees match</>
          ) : (
            <><span className="font-semibold text-zinc-900">{allCount ?? total}</span> employees</>
          )}
        </p>
        <Link href="/admin/employees/new" className={`${buttonClass.primary} min-h-10 px-3 sm:hidden`}>
          <Icon name="plus" className="size-4" />
          Add
        </Link>
      </div>

      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <Link
                href={href({ [c.key]: "", page: "1" })}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 py-1 pr-2 pl-3 text-sm font-medium text-teal-800 hover:bg-teal-100"
              >
                {c.label}
                <span aria-hidden className="text-base leading-none text-teal-600">×</span>
                <span className="sr-only">, remove filter</span>
              </Link>
            </li>
          ))}
          {chips.length > 1 && (
            <li>
              <Link href="/admin/employees" className="inline-flex min-h-9 items-center px-2 text-sm font-medium text-zinc-500 hover:text-zinc-900">
                Clear all
              </Link>
            </li>
          )}
        </ul>
      )}

      {error ? (
        <Alert tone="error">Could not load employees. Refresh the page to try again.</Alert>
      ) : !employees?.length ? (
        <EmptyState
          title={filtered ? "No employees match these filters" : "No employees yet"}
          description={filtered ? "Try a different search or clear the filters." : "Add your first employee to get started."}
          action={
            filtered ? (
              <Link href="/admin/employees" className={buttonClass.secondary}>Clear filters</Link>
            ) : (
              <Link href="/admin/employees/new" className={buttonClass.primary}>Add employee</Link>
            )
          }
        />
      ) : (
        <>
          {/* Phones and tablets: one card per employee; the whole card opens the profile, where Edit and login management live. */}
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white lg:hidden">
            {employees.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-zinc-50">
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-teal-50 text-sm font-semibold text-teal-800">
                    {initials(e.first_name, e.last_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate font-semibold text-zinc-900">
                        {e.first_name} {e.last_name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-400">{e.employee_code}</span>
                    </span>
                    <span className="block truncate text-sm text-zinc-600">{e.position?.title ?? "No position"}</span>
                    <span className="block truncate text-xs text-zinc-500">{e.department?.name ?? "No department"}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                    {!e.profile_id && <span className="text-[11px] text-zinc-400">No login</span>}
                  </span>
                  <Icon name="chevronRight" className="size-4 text-zinc-300" />
                </Link>
              </li>
            ))}
          </ul>

          {/* From lg up: the dense, sortable table; lower-value columns join as the screen widens. The box scrolls rather than widening the page. */}
          <div className="relative hidden w-0 min-w-full overflow-x-auto rounded-xl border border-zinc-200 bg-white lg:block">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  {sortHeader("code", "ID")}
                  {sortHeader("name", "Name")}
                  <th scope="col" className="px-4 py-3 text-left font-medium">Department · Position</th>
                  {sortHeader("type", "Type", "hidden 2xl:table-cell")}
                  {sortHeader("status", "Status")}
                  {sortHeader("hired", "Hired", "hidden xl:table-cell")}
                  <th scope="col" className="hidden px-4 py-3 text-left font-medium xl:table-cell">Login</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {employees.map((e) => (
                  <tr key={e.id} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-600">{e.employee_code}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-teal-50 text-xs font-semibold text-teal-800">
                          {initials(e.first_name, e.last_name)}
                        </span>
                        <div className="min-w-0">
                          <Link href={`/admin/employees/${e.id}`} className="font-medium whitespace-nowrap text-zinc-900 hover:text-teal-700 hover:underline">
                            {e.first_name} {e.last_name}
                          </Link>
                          <p className="truncate text-xs text-zinc-500">{e.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {e.department?.name ?? <span className="text-zinc-400">No department</span>}
                      <p className="text-xs text-zinc-500">{e.position?.title ?? "No position"}</p>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-700 2xl:table-cell">{TYPE_LABELS[e.employment_type]}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-zinc-700 xl:table-cell">{formatDate(e.hire_date)}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 xl:table-cell">
                      {e.profile_id ? <Badge tone="teal">Linked</Badge> : <Badge>No login</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-3 text-sm font-medium">
                        <Link href={`/admin/employees/${e.id}`} className="text-teal-700 hover:underline">
                          View<span className="sr-only"> {e.first_name} {e.last_name}</span>
                        </Link>
                        <Link href={`/admin/employees/${e.id}/edit`} className="text-teal-700 hover:underline">
                          Edit<span className="sr-only"> {e.first_name} {e.last_name}</span>
                        </Link>
                        <Link href={`/admin/employees/${e.id}#account`} className="text-teal-700 hover:underline">
                          Manage<span className="sr-only"> login for {e.first_name} {e.last_name}</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm text-zinc-600">
            <p>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={href({ page: String(page - 1) })} aria-label="Previous page" className={buttonClass.secondary}>
                  <Icon name="chevronLeft" className="size-4" />
                  <span className="hidden sm:inline">Previous</span>
                </Link>
              ) : (
                <span aria-disabled className={`${buttonClass.secondary} pointer-events-none opacity-50`}>
                  <Icon name="chevronLeft" className="size-4" />
                  <span className="hidden sm:inline">Previous</span>
                </span>
              )}
              {page < pages ? (
                <Link href={href({ page: String(page + 1) })} aria-label="Next page" className={buttonClass.secondary}>
                  <span className="hidden sm:inline">Next</span>
                  <Icon name="chevronRight" className="size-4" />
                </Link>
              ) : (
                <span aria-disabled className={`${buttonClass.secondary} pointer-events-none opacity-50`}>
                  <span className="hidden sm:inline">Next</span>
                  <Icon name="chevronRight" className="size-4" />
                </span>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function FilterSelect({ name, label, all, value, options }: { name: string; label: string; all?: string; value: string; options: [string, string][] }) {
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-zinc-600">
        {label}
      </label>
      <select id={name} name={name} defaultValue={value} className={inputClass}>
        {all !== undefined && <option value="">{all}</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
