"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

/** `short` is the label in the phone's bottom bar. `more` items sit behind a "More" button there; the sidebar shows all. */
export type NavItem = { href: string; label: string; icon: IconName; short?: string; more?: boolean };

export function NavLinks({ items }: { items: NavItem[] }) {
  return <NavList items={items} pathname={usePathname()} />;
}

// Section roots (/admin, /me) match exactly; other items match their sub-paths too.
const isActive = (href: string, pathname: string | null) =>
  pathname !== null && (href.split("/").length === 2 ? pathname === href : pathname.startsWith(href));

// Phone tab: the icon sits in a pill that fills when active. Sidebar row: icon and label, tinted when active.
const tab = (active: boolean) =>
  `group flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium ${
    active ? "text-teal-800" : "text-zinc-500"
  } md:min-h-0 md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2 md:text-sm ${
    active ? "md:bg-teal-50" : "md:text-zinc-600 md:hover:bg-zinc-100 md:hover:text-zinc-900"
  }`;
const pill = (active: boolean) =>
  `grid h-7 w-12 place-items-center rounded-full transition-colors md:h-auto md:w-auto ${active ? "bg-teal-100 md:bg-transparent" : ""}`;

// Rendered with pathname null as the Suspense fallback: dynamic routes such as
// /admin/employees/[id] only know their pathname at request time.
// One list, two layouts: a fixed bottom bar on phones, the sidebar from the md breakpoint up.
export function NavList({ items, pathname }: { items: NavItem[]; pathname: string | null }) {
  const more = items.filter((item) => item.more);
  const moreActive = more.some((m) => isActive(m.href, pathname));
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-zinc-200 bg-white/95 px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] backdrop-blur md:static md:flex-col md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
    >
      {items.map((item) => {
        const active = isActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${tab(active)} ${item.more ? "hidden md:flex" : ""}`}
          >
            <span className={pill(active)}>
              <Icon name={item.icon} />
            </span>
            {item.short ? (
              <>
                <span className="md:hidden">{item.short}</span>
                <span className="hidden md:inline">{item.label}</span>
              </>
            ) : (
              item.label
            )}
          </Link>
        );
      })}
      {more.length > 0 && (
        // keyed by the path, so the menu closes after navigating
        <details key={pathname} className="group/more relative flex flex-1 md:hidden">
          <summary className={`${tab(moreActive)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            <span className={pill(moreActive)}>
              <Icon name="more" />
            </span>
            More
          </summary>
          <div className="absolute right-0 bottom-full mb-2 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg">
            {more.map((item) => {
              const active = isActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                    active ? "bg-teal-50 text-teal-800" : "text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </details>
      )}
    </nav>
  );
}
