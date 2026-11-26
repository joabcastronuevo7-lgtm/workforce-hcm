import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequireRole } from "@/components/app-shell";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Alert, BackLink, Badge, Card, DescriptionList, buttonClass, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DAY_LABELS, STATUS_LABELS, STATUS_TONES, TYPE_LABELS, formatDate, formatDateTime, todayInOrg } from "@/lib/labels";
import { TENURE_BANDS, tenureBand } from "@/lib/business-units";
import { isUuid } from "@/lib/validation";
import { createInviteLink, linkLogin, removeSkill, setAccess, setSkill } from "../actions";
import { AvailabilityEditor } from "./availability-editor";

export const metadata: Metadata = { title: "Employee" };

export default function Page({ params, searchParams }: PageProps<"/admin/employees/[id]">) {
  return (
    <RequireRole role="admin">
      <BackLink href="/admin/employees">Employees</BackLink>
      <EmployeeProfile params={params} searchParams={searchParams} />
    </RequireRole>
  );
}

async function EmployeeProfile({
  params,
  searchParams,
}: Pick<PageProps<"/admin/employees/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data: e }, { data: allSkills }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        `id, employee_code, first_name, last_name, email, phone, employment_type, status, hire_date, location, max_weekly_hours, profile_id, created_at, updated_at,
         department:departments(id, name), position:positions(id, title),
         skills:employee_skills(proficiency, skill:skills(id, name)),
         availability:employee_availability(id, day_of_week, start_time, end_time)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("skills").select("id, name").order("name"),
  ]);
  if (!e) notFound();

  const skills = [...e.skills].sort((a, b) => (a.skill?.name ?? "").localeCompare(b.skill?.name ?? ""));
  const assigned = new Set(skills.map((s) => s.skill?.id));
  const available = (allSkills ?? []).filter((s) => !assigned.has(s.id));
  const byDay = DAY_LABELS.map((label, day) => ({
    label,
    windows: e.availability.filter((a) => a.day_of_week === day).sort((a, b) => a.start_time.localeCompare(b.start_time)),
  }));

  return (
    <>
      <header className="mb-5 flex flex-wrap items-center gap-4 md:mb-8">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-teal-50 text-lg font-semibold text-teal-800">
          {`${e.first_name[0] ?? ""}${e.last_name[0] ?? ""}`.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
            {e.first_name} {e.last_name}
          </h1>
          <p className="text-sm text-zinc-500">
            <span className="font-mono text-xs">{e.employee_code}</span> · {e.position?.title ?? "No position"}
            {e.department ? ` · ${e.department.name}` : ""}
          </p>
          <div className="mt-1.5">
            <Badge tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</Badge>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Link href={`/admin/employees/${e.id}/edit`} className={buttonClass.primary}>
            Edit employee
          </Link>
          <Link href="#account" className={buttonClass.secondary}>
            Login account
          </Link>
        </div>
      </header>

      {query.created && (
        <div className="mb-6">
          <Alert tone="success">Employee created. Add their skills or create a login below.</Alert>
        </div>
      )}

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <div className="space-y-4 md:space-y-6 lg:col-span-2">
          <Card title="Personal information">
            <DescriptionList
              items={[
                ["Full name", `${e.first_name} ${e.last_name}`],
                ["Employee ID", <span key="c" className="font-mono">{e.employee_code}</span>],
                ["Email", <a key="m" href={`mailto:${e.email}`} className="text-teal-700 hover:underline">{e.email}</a>],
                ["Phone", e.phone],
              ]}
            />
          </Card>

          <Card title="Employment">
            <DescriptionList
              items={[
                ["Department", e.department ? (
                  <Link key="d" href={`/admin/employees?department=${e.department.id}`} className="text-teal-700 hover:underline">{e.department.name}</Link>
                ) : null],
                ["Position", e.position?.title],
                ["Location", e.location],
                ["Tenure", TENURE_BANDS[tenureBand(e.hire_date, todayInOrg())]],
                ["Employment type", TYPE_LABELS[e.employment_type]],
                ["Status", <Badge key="s" tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</Badge>],
                ["Hire date", formatDate(e.hire_date)],
                ["Max weekly hours", `${e.max_weekly_hours} h`],
              ]}
            />
          </Card>

          <Card title="Skills">
            {skills.length ? (
              <ul className="mb-5 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                {skills.map(({ skill, proficiency }) =>
                  skill ? (
                    <li key={skill.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-zinc-900">{skill.name}</p>
                        <p className="text-xs text-zinc-500" aria-label={`Proficiency ${proficiency} of 5`}>
                          <span aria-hidden className="tracking-widest text-teal-600">{"●".repeat(proficiency)}</span>
                          <span aria-hidden className="tracking-widest text-zinc-300">{"●".repeat(5 - proficiency)}</span>
                          <span className="ml-2">{proficiency}/5</span>
                        </p>
                      </div>
                      <ActionForm action={removeSkill.bind(null, e.id)}>
                        <input type="hidden" name="skill_id" value={skill.id} />
                        <SubmitButton variant="dangerOutline" pendingText="Removing…">
                          Remove<span className="sr-only"> {skill.name}</span>
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="mb-5 text-sm text-zinc-500">No skills assigned yet.</p>
            )}

            <ActionForm action={setSkill.bind(null, e.id)} resetOnSuccess className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label htmlFor="skill_id" className="mb-1.5 block text-sm font-medium text-zinc-800">Skill</label>
                  <select id="skill_id" name="skill_id" required className={inputClass} defaultValue="">
                    <option value="" disabled>Select a skill</option>
                    {skills.length > 0 && (
                      <optgroup label="Update proficiency">
                        {skills.map(({ skill }) => skill && <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Add skill">
                      {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label htmlFor="proficiency" className="mb-1.5 block text-sm font-medium text-zinc-800">Proficiency</label>
                  <select id="proficiency" name="proficiency" defaultValue="3" className={`${inputClass} w-auto`}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} – {["Beginner", "Basic", "Competent", "Proficient", "Expert"][n - 1]}</option>)}
                  </select>
                </div>
                <SubmitButton>Save skill</SubmitButton>
              </div>
            </ActionForm>
          </Card>

          <Card title="Weekly availability">
            <AvailabilityEditor employeeId={e.id} byDay={byDay} />
          </Card>
        </div>

        <div className="space-y-4 md:space-y-6">
          <Card title="Login account" id="account">
            <AccountPanel employeeId={e.id} email={e.email} profileId={e.profile_id} />
          </Card>
          <Card title="Record">
            <DescriptionList items={[["Created", formatDateTime(e.created_at)], ["Last updated", formatDateTime(e.updated_at)]]} />
          </Card>
        </div>
      </div>
    </>
  );
}

type AccountState = "none" | "invited" | "registered" | "pending_password" | "active" | "disabled" | "admin";

const ACCOUNT_BADGES: Record<AccountState, [string, "zinc" | "amber" | "teal" | "green" | "red"]> = {
  none: ["No login", "zinc"],
  invited: ["Invited · not activated", "amber"],
  registered: ["Registered · not linked", "amber"],
  pending_password: ["Linked · password not set", "amber"],
  active: ["Linked · active", "green"],
  disabled: ["Access disabled", "red"],
  admin: ["Administrator login", "zinc"],
};

// Account states: an invitation is not an activation. "Invited" means a link was generated but
// not yet used; the login is linked only after the email is verified by accepting it.
async function AccountPanel({ employeeId, email, profileId }: { employeeId: string; email: string; profileId: string | null }) {
  const admin = createAdminClient();
  const supabase = await createClient();
  if (!admin) {
    return (
      <div className="space-y-4">
        <Badge tone={profileId ? "teal" : "zinc"}>{profileId ? "Linked" : "No login"}</Badge>
        <NotConfigured />
      </div>
    );
  }

  const { data: profile } = profileId
    ? await supabase.from("profiles").select("id, email, role").eq("id", profileId).maybeSingle()
    : await supabase.from("profiles").select("id, email, role").eq("email", email.toLowerCase()).maybeSingle();
  const { data: auth } = profile ? await admin.auth.admin.getUserById(profile.id) : { data: { user: null } };
  const user = auth.user;

  let state: AccountState = "none";
  if (profile?.role === "admin") state = "admin";
  else if (user) {
    const banned = Boolean(user.banned_until && new Date(user.banned_until) > new Date());
    if (banned) state = "disabled";
    else if (!user.email_confirmed_at) state = "invited";
    else if (!profileId) state = "registered";
    else if (user.user_metadata?.password_set === false) state = "pending_password";
    else state = "active";
  }
  const [label, tone] = ACCOUNT_BADGES[state];

  return (
    <div className="space-y-4">
      <Badge tone={tone}>{label}</Badge>
      {user && state !== "admin" && (
        <DescriptionList
          items={[
            ["Login email", user.email],
            ...(state === "invited" && user.invited_at ? ([["Invited", formatDateTime(user.invited_at)]] as [string, string][]) : []),
            ["Last sign-in", user.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : "Never"],
          ]}
        />
      )}

      {state === "admin" && (
        <Alert tone="info">{email} belongs to an administrator login, so it cannot be used for this employee.</Alert>
      )}

      {(state === "none" || state === "invited" || state === "pending_password") && (
        <ActionForm action={createInviteLink.bind(null, employeeId)} className="space-y-3">
          <p className="text-sm text-zinc-600">
            {state === "none" && "Generate a one-time invitation link. The employee opens it, sets their own password, and their login is linked to this record."}
            {state === "invited" && "The invitation has not been accepted yet. Generate a new link if the old one was lost or has expired."}
            {state === "pending_password" && "The employee verified their invitation but never chose a password. Generate a password setup link."}
          </p>
          <SubmitButton pendingText="Generating…">
            {state === "none" ? "Generate invitation link" : state === "invited" ? "Generate new invitation link" : "Generate password setup link"}
          </SubmitButton>
        </ActionForm>
      )}

      {state === "registered" && (
        <ActionForm action={linkLogin.bind(null, employeeId)} className="space-y-3">
          <p className="text-sm text-zinc-600">A verified login already exists for {email}. Link it to this employee record.</p>
          <SubmitButton pendingText="Linking…">Link existing login</SubmitButton>
        </ActionForm>
      )}

      {profileId && (state === "active" || state === "pending_password" || state === "disabled") && (
        <ActionForm action={setAccess.bind(null, employeeId)}>
          {state === "disabled" ? (
            <SubmitButton name="access" value="enable" variant="secondary" pendingText="Restoring…">Restore access</SubmitButton>
          ) : (
            <>
              <input type="hidden" name="access" value="disable" />
              <ConfirmSubmit
                label="Disable access"
                title="Disable sign-in?"
                message="The employee will not be able to sign in or renew their session until you restore access. Their records are kept."
                confirmLabel="Disable access"
              />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <Alert tone="info">
      Login management needs <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code> in <code className="font-mono text-xs">.env.local</code>.
    </Alert>
  );
}
