// Database access for site monitoring. Called only from service.ts.
// Reads site_monitors and site_issues for the Monitoring screen. The scan job writes site_monitors and
// site_monitor_checks (the same tables the old app's checker wrote); the alert job writes alert_state.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { asStatus } from "./rules";
import type { AlertStateRow, SiteIssue, SiteMonitor } from "./types";
import type { CheckRowInsert, MonitorRowInsert, PreviousMonitor } from "./scan-types";

type Db = SupabaseClient<Database>;

export async function listSites(db: Db): Promise<SiteMonitor[]> {
  const { data: monitors, error } = await db
    .from("site_monitors")
    .select("id,client_id,url,status,response_time_ms,http_status,security_score,broken_links_count,ssl_expires_at,domain_expires_at,last_checked_at,last_error")
    .limit(500);
  if (error || !monitors) throw new Error("Could not read site checks");
  const ids = [...new Set(monitors.map((m) => m.client_id))];
  const names = new Map<string, string>();
  const muted = new Map<string, "archived" | "paused" | "on_hold">();
  if (ids.length > 0) {
    const { data: clients, error: e2 } = await db
      .from("clients")
      .select("id,business_name,archived_at,on_hold_since,monitoring_paused_at")
      .in("id", ids);
    if (e2 || !clients) throw new Error("Could not read clients");
    for (const c of clients) {
      names.set(c.id, c.business_name);
      const reason = c.archived_at ? "archived" : c.monitoring_paused_at ? "paused" : c.on_hold_since ? "on_hold" : null;
      if (reason) muted.set(c.id, reason);
    }
  }
  return monitors.map((m) => ({
    id: m.id,
    clientId: m.client_id,
    clientName: names.get(m.client_id) ?? "Unknown client",
    url: m.url,
    status: asStatus(m.status),
    responseTimeMs: m.response_time_ms,
    httpStatus: m.http_status,
    securityScore: m.security_score,
    brokenLinks: m.broken_links_count,
    sslExpiresAt: m.ssl_expires_at,
    domainExpiresAt: m.domain_expires_at,
    lastCheckedAt: m.last_checked_at,
    lastError: m.last_error,
    alertsMuted: muted.has(m.client_id),
    ...(muted.has(m.client_id) ? { muteReason: muted.get(m.client_id) } : {}),
  }));
}

export async function listOpenIssues(db: Db): Promise<SiteIssue[]> {
  const { data, error } = await db
    .from("site_issues")
    .select("id,client_id,title,level,last_seen,web_url")
    .eq("status", "unresolved")
    .order("last_seen", { ascending: false })
    .limit(50);
  if (error || !data) throw new Error("Could not read site issues");
  return data.map((i) => ({ id: i.id, clientId: i.client_id, title: i.title, level: i.level, lastSeen: i.last_seen, webUrl: i.web_url }));
}

// --- Alert job (service-role client) -----------------------------------------

export async function listAlertState(db: Db): Promise<AlertStateRow[]> {
  const { data, error } = await db.from("alert_state").select("key,state").like("key", "site:%");
  const { data: extra, error: e2 } = await db.from("alert_state").select("key,state").like("key", "monitoring:%");
  if (error || e2 || !data || !extra) throw new Error("Could not read alert state");
  return [...data, ...extra];
}

export async function saveAlertState(db: Db, key: string, state: string, notifiedAt: Date | null): Promise<void> {
  const row: Database["public"]["Tables"]["alert_state"]["Insert"] = { key, state, updated_at: new Date().toISOString() };
  if (notifiedAt) row.notified_at = notifiedAt.toISOString();
  const { error } = await db.from("alert_state").upsert(row, { onConflict: "key" });
  if (error) throw new Error("Could not save alert state");
}

// --- Site scan job (service-role client) ---------------------------------------

/** Rows per `in (...)` query, so the request URL stays short. */
const ID_CHUNK = 100;

/** A client and every URL we could scan for it. The rules for what to scan live in service.ts (pure, tested). */
export interface ScanCandidate {
  clientId: string;
  clientName: string;
  archivedAt: string | null;
  monitoringPausedAt: string | null;
  projectUrl: string | null;
  /** The client's website URLs, oldest first. */
  websiteUrls: string[];
}

const chunks = <T>(list: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += ID_CHUNK) out.push(list.slice(i, i + ID_CHUNK));
  return out;
};

/** Three queries in all (clients, projects, websites), never one per client. */
export async function listScanCandidates(db: Db): Promise<ScanCandidate[]> {
  const { data: clients, error } = await db.from("clients").select("id,business_name,archived_at,monitoring_paused_at").limit(1000);
  if (error || !clients) throw new Error("Could not read clients");
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);

  const projectUrl = new Map<string, string>();
  const websiteUrls = new Map<string, string[]>();
  for (const part of chunks(ids)) {
    const [projects, websites] = await Promise.all([
      db.from("projects").select("client_id,production_url,created_at").in("client_id", part).not("production_url", "is", null).order("created_at", { ascending: true }),
      db.from("client_websites").select("client_id,url,created_at").in("client_id", part).order("created_at", { ascending: true }),
    ]);
    if (projects.error || !projects.data || websites.error || !websites.data) throw new Error("Could not read client websites");
    for (const p of projects.data) {
      if (p.client_id && p.production_url && !projectUrl.has(p.client_id)) projectUrl.set(p.client_id, p.production_url);
    }
    for (const w of websites.data) websiteUrls.set(w.client_id, [...(websiteUrls.get(w.client_id) ?? []), w.url]);
  }

  return clients.map((c) => ({
    clientId: c.id,
    clientName: c.business_name,
    archivedAt: c.archived_at,
    monitoringPausedAt: c.monitoring_paused_at,
    projectUrl: projectUrl.get(c.id) ?? null,
    websiteUrls: websiteUrls.get(c.id) ?? [],
  }));
}

/** What each monitor row held before this scan, so a failed lookup does not erase a known expiry date. */
export async function getPreviousMonitors(db: Db, clientIds: string[]): Promise<Map<string, PreviousMonitor>> {
  const out = new Map<string, PreviousMonitor>();
  for (const part of chunks(clientIds)) {
    const { data, error } = await db.from("site_monitors").select("client_id,status,ssl_expires_at,domain_expires_at").in("client_id", part);
    if (error || !data) throw new Error("Could not read site checks");
    for (const m of data) out.set(m.client_id, { status: m.status, sslExpiresAt: m.ssl_expires_at, domainExpiresAt: m.domain_expires_at });
  }
  return out;
}

/** Latest result (one row per client) plus a history row per scan. Errors carry no details. */
export async function saveScan(db: Db, monitor: MonitorRowInsert, check: CheckRowInsert): Promise<void> {
  const latest = await db.from("site_monitors").upsert(monitor, { onConflict: "client_id" });
  if (latest.error) throw new Error("Could not save the site check");
  const history = await db.from("site_monitor_checks").insert(check);
  if (history.error) throw new Error("Could not save the check history");
}
