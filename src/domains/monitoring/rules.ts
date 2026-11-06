// Pure rules for site monitoring: health, expiry buckets, and which alerts to send.
// No database, no clock: `now` is always passed in.
import { clip } from "@/domains/notifications/rules";
import type { PushPayload } from "@/platform/push/send";
import type { AlertStateRow, ScanOutcome, SiteMonitor, SiteStatus } from "./types";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A check older than this means the checker itself has stopped (v2 scans every 10 minutes). */
export const STALE_AFTER_MINUTES = 60;
/** Alert when this many days remain, or fewer. Each threshold fires once. */
export const EXPIRY_THRESHOLDS = [14, 7, 3, 1] as const;

export function asStatus(raw: string): SiteStatus {
  return raw === "up" || raw === "slow" || raw === "down" ? raw : "unknown";
}

export function isStale(lastCheckedAt: string | null, now: Date): boolean {
  if (!lastCheckedAt) return true;
  return now.getTime() - Date.parse(lastCheckedAt) > STALE_AFTER_MINUTES * MINUTE;
}

/** Whole days from now to `date` (negative once it has passed). Null for no date. */
export function daysLeft(date: string | null, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / DAY);
}

/**
 * Which alert bucket the remaining days fall in: 0 = expired, 1, 3, 7 or 14 = days left at most,
 * null = far enough away that no alert is due.
 */
export function expiryBucket(days: number | null): number | null {
  if (days === null) return null;
  if (days < 0) return 0;
  for (const t of [...EXPIRY_THRESHOLDS].reverse()) if (days <= t) return t;
  return null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface PlannedAlert {
  /** alert_state key this alert belongs to. */
  key: string;
  /** State to store after the alert is sent (or after silently resetting). */
  state: string;
  /** Null: update the state without telling the owner. */
  payload: PushPayload | null;
}

const stateOf = (rows: AlertStateRow[], key: string) => rows.find((r) => r.key === key)?.state ?? null;

function expiryPayload(kind: "ssl" | "domain", bucket: number, days: number, m: SiteMonitor): PushPayload {
  const what = kind === "ssl" ? "SSL certificate" : "Domain";
  const title =
    bucket === 0
      ? `${what} EXPIRED: ${m.clientName}`
      : `${kind === "ssl" ? "SSL" : "Domain"} expires in ${Math.max(days, 0)} day${days === 1 ? "" : "s"}: ${m.clientName}`;
  return { title, body: clip(`${hostOf(m.url)}. Renew it before it lapses.`, 120), url: "/monitoring", tag: `site-${m.id}-${kind}` };
}

/**
 * Decides what to tell the owner, given the sites and what was said before.
 * - Down: once when a (freshly checked) site is down; "Back up" once when it recovers.
 * - A site we have never seen is recorded silently unless it is already down.
 * - SSL and domain expiry: once per threshold, reset when renewed.
 * - Stalled checker: once when any site goes stale, silently reset when checks resume.
 * Sites whose last check is stale are not judged up or down (the data is old).
 * Sites with `alertsMuted` (archived, on hold, monitoring stopped) are ignored completely, and do not
 * count towards a stalled checker.
 */
export function planAlerts(sites: SiteMonitor[], previous: AlertStateRow[], now: Date): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  const watched = sites.filter((m) => !m.alertsMuted);

  for (const m of watched) {
    const stale = isStale(m.lastCheckedAt, now);

    // Up / down
    const statusKey = `site:${m.id}:status`;
    const was = stateOf(previous, statusKey);
    if (!stale && m.status !== "unknown") {
      const now_ = m.status === "down" ? "down" : "up";
      if (now_ === "down" && was !== "down") {
        out.push({
          key: statusKey,
          state: "down",
          payload: {
            title: `Site down: ${m.clientName}`,
            body: clip(`${hostOf(m.url)}${m.httpStatus ? ` returned ${m.httpStatus}` : ""}${m.lastError ? `. ${m.lastError}` : ""}`, 120),
            url: "/monitoring",
            tag: `site-${m.id}-status`,
          },
        });
      } else if (now_ === "up" && was === "down") {
        out.push({
          key: statusKey,
          state: "up",
          payload: { title: `Back up: ${m.clientName}`, body: clip(hostOf(m.url), 120), url: "/monitoring", tag: `site-${m.id}-status` },
        });
      } else if (now_ === "up" && was === null) {
        out.push({ key: statusKey, state: "up", payload: null });
      }
    }

    // Certificate and domain expiry (the dates stay valid even if the last check is old)
    for (const [kind, date] of [["ssl", m.sslExpiresAt], ["domain", m.domainExpiresAt]] as const) {
      const key = `site:${m.id}:${kind}`;
      const days = daysLeft(date, now);
      if (days === null) continue;
      const bucket = expiryBucket(days);
      const last = stateOf(previous, key);
      if (bucket === null) {
        if (last !== null && last !== "ok") out.push({ key, state: "ok", payload: null });
        else if (last === null) out.push({ key, state: "ok", payload: null });
        continue;
      }
      const lastBucket = last === null || last === "ok" ? null : Number(last);
      if (lastBucket === null || bucket < lastBucket) {
        out.push({ key, state: String(bucket), payload: expiryPayload(kind, bucket, days, m) });
      }
    }
  }

  // The checker itself
  const staleSites = watched.filter((m) => isStale(m.lastCheckedAt, now));
  const stallKey = "monitoring:stalled";
  const stalled = stateOf(previous, stallKey) === "stalled";
  if (staleSites.length > 0 && !stalled) {
    out.push({
      key: stallKey,
      state: "stalled",
      payload: {
        title: "Site checks look stalled",
        body: `${staleSites.length} site${staleSites.length === 1 ? " has" : "s have"} not been checked for over an hour. The checker may have stopped.`,
        url: "/monitoring",
        tag: "monitoring-stalled",
      },
    });
  } else if (staleSites.length === 0 && stalled) {
    out.push({ key: stallKey, state: "ok", payload: null });
  }

  return out;
}

/**
 * The sentence shown after "Scan now". One site: "Acme Bakery is up (412 ms)." Several: "Scanned 10 sites: 8 up,
 * 1 slow, 1 down." Sites left for the next run (out of time) and failures are said plainly, never hidden.
 */
export function scanMessage(outcomes: ScanOutcome[], skippedForTime = 0): string {
  const n = outcomes.length;
  if (n === 0) return skippedForTime > 0 ? "No site could be scanned in time. Try again." : "There are no sites to scan.";
  const only = outcomes[0];
  if (n === 1 && skippedForTime === 0 && only) {
    if (only.status === "failed") return `${only.clientName}: the scan could not be saved. Try again.`;
    const speed = only.responseTimeMs === null ? "" : ` (${only.responseTimeMs} ms)`;
    return `${only.clientName} is ${only.status}${speed}.`;
  }
  const count = (s: ScanOutcome["status"]) => outcomes.filter((o) => o.status === s).length;
  const parts = [`${count("up")} up`, ...(count("slow") > 0 ? [`${count("slow")} slow`] : []), ...(count("down") > 0 ? [`${count("down")} down`] : []), ...(count("failed") > 0 ? [`${count("failed")} could not be scanned`] : [])];
  const rest = skippedForTime > 0 ? ` ${skippedForTime} will be scanned on the next run.` : "";
  return `Scanned ${n} site${n === 1 ? "" : "s"}: ${parts.join(", ")}.${rest}`;
}

export type SiteHealthKind = "up" | "down" | "attention" | "unknown" | "off";

export interface SiteHealth {
  label: string;
  tone: "red" | "amber" | "green" | "gray";
  kind: SiteHealthKind;
}

/** Archived clients leave the Monitoring list, as they leave every other list. Paused ones stay, marked as not monitored. */
export function isListed(m: Pick<SiteMonitor, "muteReason">): boolean {
  return m.muteReason !== "archived";
}

/**
 * What the Monitoring screen says about a site. A site whose monitoring was stopped is "Monitoring off", not a
 * problem: it is not scanned, so its last check is old on purpose. Everything else is judged on its last check.
 */
export function siteHealth(m: Pick<SiteMonitor, "status" | "lastCheckedAt" | "muteReason">, now: Date): SiteHealth {
  if (m.muteReason === "archived") return { label: "Archived", tone: "gray", kind: "off" };
  if (m.muteReason === "paused") return { label: "Monitoring off", tone: "gray", kind: "off" };
  if (isStale(m.lastCheckedAt, now)) return { label: "No recent check", tone: "amber", kind: "attention" };
  if (m.status === "down") return { label: "Down", tone: "red", kind: "down" };
  if (m.status === "slow") return { label: "Slow", tone: "amber", kind: "attention" };
  if (m.status === "up") return { label: "Up", tone: "green", kind: "up" };
  return { label: "Unknown", tone: "gray", kind: "unknown" };
}
