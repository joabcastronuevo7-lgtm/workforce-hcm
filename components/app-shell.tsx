import { Suspense, type ReactNode } from "react";
import { getCurrentUser, requireRole, type Role } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { Brand } from "./brand";
import { Icon } from "./icons";
import { NavLinks, NavList, type NavItem } from "./nav-links";

// Shared shell for the admin and employee areas. The chrome is static; the user menu reads
// the session behind its own Suspense boundary. Pages gate themselves with <RequireRole>.
// Phones: a sticky top bar (brand, account menu) and a fixed bottom tab bar. From md up: a sticky sidebar.
export function AppShell({
  areaLabel,
  nav,
  children,
}: {
  areaLabel: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 md:flex-row">
      {/* No backdrop-filter here: it would become the containing block of the fixed bottom nav inside. */}
      <aside className="sticky top-0 z-30 flex flex-col gap-4 border-b border-zinc-200 bg-white px-4 py-2.5 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0 md:p-4">
        <div className="flex items-center justify-between gap-3 md:block">
          <Brand />
          <p className="hidden text-xs font-medium tracking-wide text-zinc-400 uppercase md:mt-6 md:mb-1 md:block md:px-3">{areaLabel}</p>
          <div className="md:hidden">
            <Suspense fallback={<div className="size-10" />}>
              <AccountMenu areaLabel={areaLabel} />
            </Suspense>
          </div>
        </div>
        <Suspense fallback={<NavList items={nav} pathname={null} />}>
          <NavLinks items={nav} />
        </Suspense>
        <div className="mt-auto hidden md:block">
          <Suspense fallback={<div className="h-16" />}>
            <UserMenu />
          </Suspense>
        </div>
      </aside>

      {/* pb-28 keeps the last content above the phone's fixed bottom bar. */}
      <main className="w-full min-w-0 flex-1 px-4 pt-5 pb-28 md:px-8 md:py-8 lg:px-10">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

// Gate page content on the server. It must live in the page, not the layout: Next renders and
// sends a page segment independently of its layout, so a layout-level gate cannot hide it.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <RoleGate role={role}>{children}</RoleGate>
    </Suspense>
  );
}

async function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  await requireRole(role);
  return children;
}

const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

function SignOutButton({ className }: { className: string }) {
  return (
    <form action={signOut}>
      <button type="submit" className={className}>
        <Icon name="logout" className="size-4" />
        Sign out
      </button>
    </form>
  );
}

// Phones: the account (name, email, sign out) sits behind an avatar button in the top bar.
async function AccountMenu({ areaLabel }: { areaLabel: string }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const name = user.fullName || user.email;

  return (
    <details className="relative">
      <summary
        aria-label="Account"
        className="grid size-10 cursor-pointer list-none place-items-center rounded-full bg-teal-700 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"
      >
        {initials(name)}
      </summary>
      <div className="absolute top-full right-0 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{areaLabel}</p>
        <p className="mt-1 truncate text-sm font-semibold text-zinc-900">{name}</p>
        <p className="truncate text-xs text-zinc-500">{user.email}</p>
        <div className="mt-3 border-t border-zinc-200 pt-3">
          <SignOutButton className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100" />
        </div>
      </div>
    </details>
  );
}

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="border-t border-zinc-200 pt-4">
      <div className="flex items-center gap-3 px-1">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-teal-50 text-xs font-semibold text-teal-800">
          {initials(user.fullName || user.email)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900">{user.fullName || user.email}</p>
          <p className="truncate text-xs text-zinc-500">{user.email}</p>
        </div>
      </div>
      <div className="mt-3">
        <SignOutButton className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100" />
      </div>
    </div>
  );
}
