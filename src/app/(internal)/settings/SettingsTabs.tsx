"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/ui/Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/settings/business-profile", label: "Business", icon: "storefront" },
  { href: "/settings/catalog", label: "Catalog", icon: "sell" },
  { href: "/settings/calendar", label: "Calendar", icon: "calendar_month" },
  { href: "/settings/notifications", label: "Notifications", icon: "notifications" },
  { href: "/settings/users", label: "Users", icon: "group" },
  { href: "/settings/audit-log", label: "Audit log", icon: "history" },
  { href: "/settings/system-status", label: "System", icon: "monitor_heart" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      {TABS.map((t) => {
        const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`flex h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[14px] font-medium ${on ? "border-primary bg-primary text-on-primary" : "border-line2 bg-surface text-ink"}`}
          >
            <Icon name={t.icon} size={17} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
