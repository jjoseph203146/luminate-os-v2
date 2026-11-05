// The five destinations (docs: Screens and Functionality for Design).
// A destination that is not built yet is listed as disabled, never hidden.

export type Destination = {
  key: "today" | "clients" | "work" | "growth" | "money";
  label: string;
  href: string;
  enabled: boolean;
  /** Path prefixes that mark this destination as active. */
  match: string[];
};

export const DESTINATIONS: Destination[] = [
  { key: "today", label: "Today", href: "/", enabled: true, match: ["/"] },
  { key: "clients", label: "Clients", href: "/clients", enabled: true, match: ["/clients"] },
  { key: "work", label: "Work", href: "/work", enabled: true, match: ["/work"] },
  { key: "growth", label: "Growth", href: "/growth", enabled: false, match: ["/growth"] },
  { key: "money", label: "Money", href: "/money", enabled: false, match: ["/money"] },
];

export function isActive(destination: Destination, pathname: string): boolean {
  if (destination.key === "today") return pathname === "/";
  return destination.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
