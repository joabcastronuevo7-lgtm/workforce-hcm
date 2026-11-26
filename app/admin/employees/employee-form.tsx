"use client";

import { useActionState, useState, startTransition } from "react";
import Link from "next/link";
import { Field, inputClass, buttonClass } from "@/components/ui";
import { FormMessage, type ActionState, type FormAction } from "@/components/action-form";
import { STATUS_LABELS, TYPE_LABELS, type EmployeeStatus, type EmploymentType } from "@/lib/labels";

export type EmployeeFormValues = {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department_id: string | null;
  position_id: string | null;
  location: string | null;
  employment_type: EmploymentType;
  status: EmployeeStatus;
  hire_date: string;
};

type Option = { id: string; name: string };
type PositionOption = { id: string; title: string; department_id: string };

// Create and edit share this form. The position list follows the chosen department;
// the server re-checks that pairing, so the client filter is only a convenience.
export function EmployeeForm({
  action,
  initial,
  departments,
  positions,
  submitLabel,
  cancelHref,
}: {
  action: FormAction;
  initial: EmployeeFormValues;
  departments: Option[];
  positions: PositionOption[];
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [departmentId, setDepartmentId] = useState(initial.department_id ?? "");
  const [positionId, setPositionId] = useState(initial.position_id ?? "");
  const errors = state.fieldErrors ?? {};
  const deptPositions = positions.filter((p) => p.department_id === departmentId);

  const input = (name: keyof EmployeeFormValues, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={name}
      name={name}
      defaultValue={initial[name] ?? ""}
      aria-invalid={errors[name] ? true : undefined}
      aria-describedby={errors[name] ? `${name}-error` : undefined}
      className={inputClass}
      {...props}
    />
  );

  return (
    <form
      noValidate
      action={formAction}
      onSubmit={(event) => {
        // Submit without React's automatic form reset, so entries survive a validation error.
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="space-y-6"
    >
      <FormMessage state={state} />

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-zinc-900">Personal information</legend>
        <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" htmlFor="first_name" error={errors.first_name} required>
          {input("first_name", { autoComplete: "off", required: true })}
        </Field>
        <Field label="Last name" htmlFor="last_name" error={errors.last_name} required>
          {input("last_name", { autoComplete: "off", required: true })}
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email} required hint="Used to link the employee's login.">
          {input("email", { type: "email", autoComplete: "off", required: true })}
        </Field>
        <Field label="Phone number" htmlFor="phone" error={errors.phone}>
          {input("phone", { type: "tel", autoComplete: "off", placeholder: "+63 917 555 0142" })}
        </Field>
        </div>
      </fieldset>

      <fieldset className="border-t border-zinc-200 pt-6">
        <legend className="sr-only">Employment</legend>
        <h3 aria-hidden className="mb-3 text-sm font-semibold text-zinc-900">Employment</h3>
        <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Employee ID" htmlFor="employee_code" error={errors.employee_code} required hint="For example EMP-0042.">
          {input("employee_code", { autoComplete: "off", required: true, className: `${inputClass} uppercase` })}
        </Field>
        <Field label="Hire date" htmlFor="hire_date" error={errors.hire_date} required>
          {input("hire_date", { type: "date", required: true })}
        </Field>
        <Field label="Department" htmlFor="department_id" error={errors.department_id} required>
          <select
            id="department_id"
            name="department_id"
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setPositionId("");
            }}
            aria-invalid={errors.department_id ? true : undefined}
            className={inputClass}
            required
          >
            <option value="">Select a department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Position"
          htmlFor="position_id"
          error={errors.position_id}
          required
          hint={departmentId && !deptPositions.length ? "This department has no positions yet." : undefined}
        >
          <select
            id="position_id"
            name="position_id"
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            disabled={!departmentId}
            aria-invalid={errors.position_id ? true : undefined}
            className={inputClass}
            required
          >
            <option value="">{departmentId ? "Select a position" : "Choose a department first"}</option>
            {deptPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location" htmlFor="location" error={errors.location} hint="Site or city. Leave empty if not known.">
          {input("location", { autoComplete: "off", maxLength: 60 })}
        </Field>
        <Field label="Employment type" htmlFor="employment_type" error={errors.employment_type} required>
          <select id="employment_type" name="employment_type" defaultValue={initial.employment_type} className={inputClass}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Employment status" htmlFor="status" error={errors.status} required>
          <select id="status" name="status" defaultValue={initial.status} className={inputClass}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2 border-t border-zinc-200 pt-6">
        <Link href={cancelHref} className={buttonClass.secondary}>
          Cancel
        </Link>
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
