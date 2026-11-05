// Database access for the clients domain. Read-only. Called only from service.ts.
// Runs as the signed-in owner, so row-level security applies.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { summarizeMonitor, type MonitorRow } from "./rules";
import type { ClientListItem, ClientWorkspace } from "./types";

type Db = SupabaseClient<Database>;

export class RepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoError";
  }
}

function must<T>(what: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error || result.data === null) throw new RepoError(`Could not ${what}`);
  return result.data;
}

const LIST_LIMIT = 200;
const MONITOR_COLUMNS = "client_id,status,url,last_checked_at,http_status,response_time_ms,ssl_expires_at,domain_expires_at";

export async function listClients(
  db: Db,
  opts: { search: string; status: string | null; includeArchived: boolean },
  now: Date,
): Promise<ClientListItem[]> {
  let query = db
    .from("clients")
    .select("id,business_name,contact_name,email,phone,status,plan_name,subscription_price,archived_at,monitoring_paused_at")
    .order("business_name", { ascending: true })
    .limit(LIST_LIMIT);

  if (!opts.includeArchived) query = query.is("archived_at", null);
  if (opts.status) query = query.eq("status", opts.status);

  if (opts.search) {
    const term = `%${opts.search}%`;
    // Websites, extra emails and extra phones also lead to a client.
    const [sites, emails, phones] = await Promise.all([
      db.from("client_websites").select("client_id").ilike("url", term).limit(100),
      db.from("client_emails").select("client_id").ilike("email", term).limit(100),
      db.from("client_phones").select("client_id").ilike("phone", term).limit(100),
    ]);
    const ids = new Set<string>();
    for (const r of [sites.data, emails.data, phones.data]) for (const row of r ?? []) ids.add(row.client_id);
    const parts = [
      `business_name.ilike.${term}`,
      `contact_name.ilike.${term}`,
      `email.ilike.${term}`,
      `phone.ilike.${term}`,
    ];
    if (ids.size > 0) parts.push(`id.in.(${[...ids].join(",")})`);
    query = query.or(parts.join(","));
  }

  const clients = must("list clients", await query);
  if (clients.length === 0) return [];
  const clientIds = clients.map((c) => c.id);

  const [monitors, open, siteRows] = await Promise.all([
    db.from("site_monitors").select(MONITOR_COLUMNS).in("client_id", clientIds),
    db.from("requests").select("client_id").neq("status", "completed").in("client_id", clientIds),
    db.from("client_websites").select("id,client_id,label,url").in("client_id", clientIds).order("created_at"),
  ]);
  const sitesByClient = new Map<string, { id: string; label: string; url: string }[]>();
  for (const w of must("read websites", siteRows)) {
    const list = sitesByClient.get(w.client_id) ?? [];
    list.push({ id: w.id, label: w.label, url: w.url });
    sitesByClient.set(w.client_id, list);
  }
  const monitorByClient = new Map((must("read monitoring", monitors)).map((m) => [m.client_id, m]));
  const openByClient = new Map<string, number>();
  for (const r of must("count requests", open)) openByClient.set(r.client_id, (openByClient.get(r.client_id) ?? 0) + 1);

  return clients.map((c) => ({
    id: c.id,
    businessName: c.business_name,
    contactName: c.contact_name,
    email: c.email,
    phone: c.phone,
    status: c.status,
    planName: c.plan_name,
    subscriptionPrice: c.subscription_price,
    openRequests: openByClient.get(c.id) ?? 0,
    monitor: summarizeMonitor((monitorByClient.get(c.id) as MonitorRow) ?? null, c.monitoring_paused_at !== null, now),
    websites: sitesByClient.get(c.id) ?? [],
    archived: c.archived_at !== null,
  }));
}

export async function getClientWorkspace(db: Db, id: string, now: Date): Promise<ClientWorkspace | null> {
  const clientRes = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (clientRes.error) throw new RepoError("Could not read the client");
  const c = clientRes.data;
  if (!c) return null;

  const [emails, phones, websites, projects, requests, payments, documents, activity, monitor] = await Promise.all([
    db.from("client_emails").select("email").eq("client_id", id).order("created_at"),
    db.from("client_phones").select("phone").eq("client_id", id).order("created_at"),
    db.from("client_websites").select("id,label,url").eq("client_id", id).order("created_at"),
    db.from("projects").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    db
      .from("requests")
      .select("id,display_id,title,status,category,billable_flag,created_at,completed_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("revenue_events")
      .select("id,amount,status,event_type,paid_at,created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(12),
    db
      .from("client_documents")
      .select("id,file_name,category,created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("activity_log")
      .select("id,action,entity_type,created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("site_monitors").select(MONITOR_COLUMNS).eq("client_id", id).maybeSingle(),
  ]);

  const requestRows = must("read requests", requests);
  return {
    client: {
      id: c.id,
      businessName: c.business_name,
      contactName: c.contact_name,
      email: c.email,
      phone: c.phone,
      status: c.status,
      planName: c.plan_name,
      subscriptionPrice: c.subscription_price,
      clientSince: c.client_since,
      revisionsIncluded: c.revisions_included,
      revisionsUsed: c.revision_usage_current_cycle,
      onHoldSince: c.on_hold_since,
      monitoringPausedAt: c.monitoring_paused_at,
      archivedAt: c.archived_at,
      hasStripeCustomer: c.stripe_customer_id !== null,
    },
    emails: must("read emails", emails).map((e) => e.email),
    phones: must("read phones", phones).map((p) => p.phone),
    websites: must("read websites", websites),
    projects: must("read projects", projects).map((p) => ({
      id: p.id,
      name: p.name,
      productionUrl: p.production_url,
      stagingUrl: p.staging_url,
      githubUrl: p.github_url,
      hostingPlatform: p.hosting_platform,
      supabaseProjectId: p.supabase_project_id,
      sentryProject: p.sentry_project,
      contractStatus: p.contract_status,
      blockerNote: p.blocker_note,
      buildValue: p.build_value,
      targetDate: p.target_date,
      launchedAt: p.launched_at,
      lastDeployedAt: p.last_deployed_at,
    })),
    requests: requestRows.map((r) => ({
      id: r.id,
      displayId: r.display_id,
      title: r.title,
      status: r.status,
      category: r.category,
      billable: r.billable_flag,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    })),
    openRequests: requestRows.filter((r) => r.status !== "completed").length,
    payments: must("read payments", payments).map((p) => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      eventType: p.event_type,
      paidAt: p.paid_at,
      createdAt: p.created_at,
    })),
    documents: must("read documents", documents).map((d) => ({
      id: d.id,
      fileName: d.file_name,
      category: d.category,
      createdAt: d.created_at,
    })),
    activity: must("read activity", activity).map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entity_type,
      createdAt: a.created_at,
    })),
    monitor: summarizeMonitor(
      (monitor.data as MonitorRow) ?? null,
      c.monitoring_paused_at !== null,
      now,
    ),
  };
}
