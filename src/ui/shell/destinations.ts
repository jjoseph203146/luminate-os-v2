// The five destinations (docs: Screens and Functionality for Design).
// A destination that is not built yet is listed as disabled, never hidden.
import type { IconName } from "@/ui/Icon";

export type Destination = {
  key: "today" | "clients" | "work" | "growth" | "money";
  label: string;
  href: string;
  icon: IconName;
  enabled: boolean;
  /** Path prefixes that mark this destination as active. */
  match: string[];
};

export const DESTINATIONS: Destination[] = [
  { key: "today", label: "Today", href: "/", icon: "today", enabled: true, match: ["/"] },
  { key: "clients", label: "Clients", href: "/clients", icon: "group", enabled: true, match: ["/clients"] },
  { key: "work", label: "Work", href: "/work", icon: "checklist", enabled: true, match: ["/work"] },
  { key: "growth", label: "Growth", href: "/growth", icon: "trending_up", enabled: true, match: ["/growth"] },
  { key: "money", label: "Money", href: "/money", icon: "account_balance_wallet", enabled: true, match: ["/money"] },
];

export function isActive(destination: Destination, pathname: string): boolean {
  if (destination.key === "today") return pathname === "/";
  return destination.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
