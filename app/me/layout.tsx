import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-links";

export const metadata: Metadata = { title: { template: "%s · Workforce", default: "My dashboard · Workforce" } };

const nav: NavItem[] = [
  { href: "/me", label: "Dashboard", short: "Home", icon: "home" },
  { href: "/me/schedule", label: "My schedule", short: "Schedule", icon: "calendar" },
  { href: "/me/attendance", label: "Attendance", short: "Time", icon: "clock" },
  { href: "/me/availability", label: "Availability", icon: "check" },
  { href: "/me/telegram", label: "Telegram", icon: "send" },
  // Profile is not built yet, so it is not linked from the menu. The route still exists.
];

export default function EmployeeLayout({ children }: LayoutProps<"/me">) {
  return (
    <AppShell areaLabel="Employee" nav={nav}>
      {children}
    </AppShell>
  );
}
