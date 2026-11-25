import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";

export const metadata: Metadata = { title: { template: "%s · Workforce", default: "My dashboard · Workforce" } };

const nav: NavItem[] = [
  { href: "/me", label: "Dashboard", short: "Home", icon: "home" },
  { href: "/me/schedule", label: "My schedule", short: "Schedule", icon: "calendar" },
  { href: "/me/availability", label: "Availability", icon: "clock" },
  { href: "/me/telegram", label: "Telegram", icon: "send" },
  // Attendance and Profile are not built yet, so they are not linked from the menu. The routes still exist.
];

export default function EmployeeLayout({ children }: LayoutProps<"/me">) {
  return (
    <AppShell areaLabel="Employee" nav={nav}>
      {children}
    </AppShell>
  );
}
