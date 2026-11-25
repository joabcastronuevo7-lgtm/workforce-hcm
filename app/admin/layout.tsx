import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";

export const metadata: Metadata = { title: { template: "%s · Admin · Workforce", default: "Admin · Workforce" } };

const nav: NavItem[] = [
  { href: "/admin", label: "Dashboard", short: "Home", icon: "home" },
  { href: "/admin/employees", label: "Employees", icon: "users" },
  { href: "/admin/schedules", label: "Schedules", icon: "calendar" },
  { href: "/admin/reports", label: "Reports", icon: "chart" },
  { href: "/admin/departments", label: "Departments", icon: "building", more: true },
  { href: "/admin/positions", label: "Positions", icon: "briefcase", more: true },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <AppShell areaLabel="Administrator" nav={nav}>
      {children}
    </AppShell>
  );
}
