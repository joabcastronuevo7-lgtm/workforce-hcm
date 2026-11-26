import type { Metadata } from "next";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { BackLink, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { todayInOrg } from "@/lib/labels";
import { createEmployee } from "../actions";
import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = { title: "Add employee" };

export default function Page() {
  return (
    <RequireRole role="admin">
      <BackLink href="/admin/employees">Employees</BackLink>
      <PageHeader title="Add employee" description="Create an employee record. You can create their login afterwards." />
      <NewEmployee />
    </RequireRole>
  );
}

async function NewEmployee() {
  const supabase = await createClient();
  const [{ data: departments }, { data: positions }] = await Promise.all([
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title, department_id").order("title"),
  ]);

  return (
    <div className="max-w-3xl">
      <Card>
        <EmployeeForm
          action={createEmployee}
          departments={departments ?? []}
          positions={positions ?? []}
          submitLabel="Create employee"
          cancelHref="/admin/employees"
          initial={{
            employee_code: "",
            first_name: "",
            last_name: "",
            email: "",
            phone: "",
            department_id: null,
            position_id: null,
            location: null,
            employment_type: "full_time",
            status: "active",
            hire_date: todayInOrg(),
          }}
        />
      </Card>
    </div>
  );
}
