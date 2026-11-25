import type { Role } from "@/lib/auth";
import { RequireRole } from "./app-shell";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-5 md:mb-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">{title}</h1>
      {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
    </header>
  );
}

export function Placeholder({
  role,
  title,
  description,
  phase,
}: {
  role: Role;
  title: string;
  description: string;
  phase: number;
}) {
  return (
    <RequireRole role={role}>
      <PageHeader title={title} description={description} />
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
        <p className="text-sm font-medium text-zinc-700">Not built yet</p>
        <p className="mt-1 text-sm text-zinc-500">Planned for Phase {phase}.</p>
      </div>
    </RequireRole>
  );
}
