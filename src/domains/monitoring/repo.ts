// Database access for site monitoring. Called only from service.ts.
// Reads what the old app's checker wrote (site_monitors, site_issues). Writes only alert_state.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { asStatus } from "./rules";
import type { AlertStateRow, SiteIssue, SiteMonitor } from "./types";

type Db = SupabaseClient<Database>;

export async function listSites(db: Db): Promise<SiteMonitor[]> {
  const { data: monitors, error } = await db
    .from("site_monitors")
    .select("id,client_id,url,status,response_time_ms,http_status,security_score,broken_links_count,ssl_expires_at,domain_expires_at,last_checked_at,last_error")
    .limit(500);
  if (error || !monitors) throw new Error("Could not read site checks");
  const ids = [...new Set(monitors.map((m) => m.client_id))];
  const names = new Map<string, string>();
  const muted = new Set<string>();
  if (ids.length > 0) {
    const { data: clients, error: e2 } = await db
      .from("clients")
      .select("id,business_name,archived_at,on_hold_since,monitoring_paused_at")
      .in("id", ids);
    if (e2 || !clients) throw new Error("Could not read clients");
    for (const c of clients) {
      names.set(c.id, c.business_name);
      if (c.archived_at || c.on_hold_since || c.monitoring_paused_at) muted.add(c.id);
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
