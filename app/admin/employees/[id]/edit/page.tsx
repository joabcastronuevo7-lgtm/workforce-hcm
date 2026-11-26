import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RequireRole } from "@/components/app-shell";
import { PageHeader } from "@/components/placeholder";
import { BackLink, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { updateEmployee } from "../../actions";
import { EmployeeForm } from "../../employee-form";

export const metadata: Metadata = { title: "Edit employee" };

export default function Page({ params }: PageProps<"/admin/employees/[id]/edit">) {
  return (
    <RequireRole role="admin">
      <EditEmployee params={params} />
    </RequireRole>
  );
}

async function EditEmployee({ params }: { params: PageProps<"/admin/employees/[id]/edit">["params"] }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data: employee }, { data: departments }, { data: positions }] = await Promise.all([
    supabase
      .from("employees")
      .select("employee_code, first_name, last_name, email, phone, department_id, position_id, employment_type, status, hire_date, location")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("positions").select("id, title, department_id").order("title"),
  ]);
  if (!employee) notFound();

  return (
    <>
      <BackLink href={`/admin/employees/${id}`}>
        {employee.first_name} {employee.last_name}
      </BackLink>
      <PageHeader title="Edit employee" description={employee.employee_code} />
      <div className="max-w-3xl">
        <Card>
          <EmployeeForm
            action={updateEmployee.bind(null, id)}
            initial={employee}
            departments={departments ?? []}
            positions={positions ?? []}
            submitLabel="Save changes"
            cancelHref={`/admin/employees/${id}`}
          />
        </Card>
      </div>
    </>
  );
}
