import Link from "next/link";
import type { ReactNode } from "react";

// Shared presentational pieces for the admin area. No hooks: usable from Server Components.

// Touch-sized on phones (44px, 16px text so iOS does not zoom on focus), denser from the md breakpoint up.
export const inputClass =
  "block min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none transition-colors focus:border-teal-600 focus:ring-3 focus:ring-teal-600/15 disabled:bg-zinc-100 disabled:text-zinc-500 aria-invalid:border-red-400 md:min-h-10 md:text-sm";

const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-10";

export const buttonClass = {
  primary: `${button} bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900`,
  secondary: `${button} border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100`,
  danger: `${button} bg-red-600 text-white hover:bg-red-700 active:bg-red-800`,
  dangerOutline: `${button} border border-red-200 bg-white text-red-700 hover:bg-red-50 active:bg-red-100`,
};

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-800">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  );
}

const tones = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  teal: "bg-teal-50 text-teal-800 ring-teal-600/20",
  zinc: "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
};

export function Badge({ tone = "zinc", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ title, action, id, children }: { title?: string; action?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl border border-zinc-200 bg-white shadow-xs md:scroll-mt-6">
      {title && (
        <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-3 md:px-5">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-zinc-200 bg-zinc-50 text-zinc-700",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2.5 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-ml-1 mb-3 inline-flex min-h-11 items-center px-1 text-sm font-medium text-zinc-500 hover:text-zinc-900 md:mb-4 md:min-h-0">
      ← {children}
    </Link>
  );
}

export function DescriptionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt className="text-xs font-medium text-zinc-500">{term}</dt>
          <dd className="mt-0.5 text-sm text-zinc-900">{value ?? <span className="text-zinc-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
