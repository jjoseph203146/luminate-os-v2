// Pure rules for the clients domain (no database, easy to test).
import type { MonitorState, MonitorSummary } from "./types";

/** Monitoring older than this is "stale", never healthy. The old app's check cadence is unverified, so this is deliberately generous. */
export const MONITOR_STALE_HOURS = 24;

const SEARCH_MAX = 60;

/** Makes a search term safe to place inside a PostgREST or() filter. Returns "" when nothing usable is left. */
export function cleanSearch(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/[,()"\\%*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX);
}

export type MonitorRow = {
  status: string;
  url: string;
  last_checked_at: string | null;
  http_status: number | null;
  response_time_ms: number | null;
  ssl_expires_at: string | null;
  domain_expires_at: string | null;
} | null;

const EMPTY: Omit<MonitorSummary, "state" | "label" | "tone"> = {
  url: null,
  lastCheckedAt: null,
  httpStatus: null,
  responseTimeMs: null,
  sslExpiresAt: null,
  domainExpiresAt: null,
};

export function summarizeMonitor(row: MonitorRow, paused: boolean, now: Date): MonitorSummary {
  if (paused) return { ...EMPTY, state: "paused", label: "Monitoring paused", tone: "neutral", url: row?.url ?? null, lastCheckedAt: row?.last_checked_at ?? null };
  if (!row) return { ...EMPTY, state: "none", label: "No monitoring", tone: "neutral" };

  const base = {
    url: row.url,
    lastCheckedAt: row.last_checked_at,
    httpStatus: row.http_status,
    responseTimeMs: row.response_time_ms,
    sslExpiresAt: row.ssl_expires_at,
    domainExpiresAt: row.domain_expires_at,
  };

  if (!row.last_checked_at) return { ...base, state: "stale", label: "Never checked", tone: "warn" };
  const ageHours = (now.getTime() - new Date(row.last_checked_at).getTime()) / 3_600_000;
  if (Number.isNaN(ageHours) || ageHours > MONITOR_STALE_HOURS) {
    return { ...base, state: "stale", label: "Check is out of date", tone: "warn" };
  }
  const known: Record<string, [MonitorState, string, MonitorSummary["tone"]]> = {
    up: ["up", "Up", "ok"],
    slow: ["slow", "Slow", "warn"],
    down: ["down", "Down", "bad"],
  };
  const hit = known[row.status];
  if (!hit) return { ...base, state: "unknown", label: "Unknown", tone: "neutral" };
  return { ...base, state: hit[0], label: hit[1], tone: hit[2] };
}

/** "5 min ago", "3 h ago", "2 d ago". Used next to every figure so its age is visible. */
export function ageLabel(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "unknown";
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function statusTone(status: string): "ok" | "warn" | "bad" | "info" | "neutral" {
  switch (status) {
    case "active":
      return "ok";
    case "past_due":
      return "bad";
    case "onboarding":
      return "info";
    case "paused":
      return "neutral";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "Active",
    past_due: "Past due",
    onboarding: "Onboarding",
    paused: "Paused",
    new: "New",
    in_review: "In review",
    in_progress: "In progress",
    waiting_on_client: "Waiting on client",
    completed: "Completed",
    ready: "Ready",
    waiting: "Waiting",
    pending: "Pending",
    paid: "Paid",
    failed: "Failed",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

export const CLIENT_STATUS_FILTERS = ["active", "past_due", "onboarding", "paused"] as const;
export type ClientStatusFilter = (typeof CLIENT_STATUS_FILTERS)[number];

export function parseStatusFilter(raw: string | null | undefined): ClientStatusFilter | null {
  return (CLIENT_STATUS_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as ClientStatusFilter) : null;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
}

/** Only http(s) links are ever rendered as links. Anything else returns null. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Digits and a leading + only, for tel: and sms: links. */
export function phoneHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/(?!^\+)[^\d]/g, "");
  return cleaned.replace("+", "").length >= 7 ? cleaned : null;
}
