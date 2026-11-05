// Pure rules for the admin domain (Settings). One implementation each, unit-tested.

/** "49", "49.5", "$1,200.50" -> cents. Anything else -> null. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Plain dollars for an input field: 4900 -> "49.00". */
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function linesToList(text: string, maxItems = 20, maxLength = 120): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, maxItems)
    .map((l) => l.slice(0, maxLength));
}

export type PricingModel = "fixed" | "percent" | "quoted";

/** A catalog item's price fields must match its pricing model. Returns a message or null. */
export function pricingProblem(
  model: PricingModel,
  values: { priceCents: number | null; percentValue: number | null },
): string | null {
  if (model === "fixed") {
    if (values.priceCents === null) return "A fixed-price item needs a price.";
    if (values.percentValue !== null) return "A fixed-price item cannot have a percentage.";
  }
  if (model === "percent") {
    if (values.percentValue === null) return "A percentage item needs a percentage.";
    if (values.priceCents !== null) return "A percentage item cannot have a fixed price.";
  }
  if (model === "quoted" && (values.priceCents !== null || values.percentValue !== null)) {
    return "A quoted item has no price or percentage.";
  }
  return null;
}

/** Owners can disable others, never themselves, never the last active owner. */
export function disableProblem(input: {
  actorUserId: string;
  targetUserId: string;
  targetIsActiveOwner: boolean;
  activeOwnerCount: number;
}): string | null {
  if (input.actorUserId === input.targetUserId) return "You cannot disable your own account.";
  if (input.targetIsActiveOwner && input.activeOwnerCount <= 1) return "You cannot disable the last active owner.";
  return null;
}

export function isActiveUser(bannedUntil: string | null | undefined, now: Date): boolean {
  if (!bannedUntil) return true;
  const t = Date.parse(bannedUntil);
  return Number.isNaN(t) || t <= now.getTime();
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
