// Database access for the work domain. Called only from service.ts.
// Reads and writes run as the signed-in owner (row-level security applies).
// The one exception is nextRequestDisplayId, which needs the service role because the
// database function is executable by that role only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createAdminClient } from "@/platform/db/server";
import { isValidDisplayId } from "./rules";
import type { ClientOption, WorkRequest, WorkTask } from "./types";

type Db = SupabaseClient<Database>;

export class RepoError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
}

function fail(what: string, error: { code?: string } | null): never {
  throw new RepoError(`Could not ${what}`, error?.code ?? null);
}

/** Service role is used here and nowhere else in this domain. */
export async function nextRequestDisplayId(): Promise<string> {
  const { data, error } = await createAdminClient().rpc("next_request_display_id");
  if (error || !isValidDisplayId(data)) throw new RepoError("Could not get a request number");
  return data;
}

export async function getClientName(db: Db, id: string): Promise<string | null> {
  const { data, error } = await db.from("clients").select("business_name").eq("id", id).maybeSingle();
  if (error) fail("read the client", error);
  return data?.business_name ?? null;
}

export async function listClientOptions(db: Db): Promise<ClientOption[]> {
  const [clients, sites] = await Promise.all([
    db.from("clients").select("id,business_name").is("archived_at", null).order("business_name").limit(500),
    db.from("client_websites").select("client_id,url").order("created_at").limit(2000),
  ]);
  if (clients.error) fail("list clients", clients.error);
  if (sites.error) fail("list websites", sites.error);
  const byClient = new Map<string, string[]>();
  for (const w of sites.data) byClient.set(w.client_id, [...(byClient.get(w.client_id) ?? []), w.url]);
  return clients.data.map((c) => ({ id: c.id, name: c.business_name, websites: byClient.get(c.id) ?? [] }));
}

/** True when the address is one of the client's recorded websites. */
export async function clientHasWebsite(db: Db, clientId: string, url: string): Promise<boolean> {
  const { data, error } = await db.from("client_websites").select("id").eq("client_id", clientId).eq("url", url).limit(1);
  if (error) fail("check the website", error);
  return data.length > 0;
}

export async function findRecentRequest(db: Db, clientId: string, title: string, since: string) {
  const { data, error } = await db
    .from("requests")
    .select("id,display_id")
    .eq("client_id", clientId)
    .eq("title", title)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("check for a duplicate request", error);
  return data ? { id: data.id, displayId: data.display_id } : null;
}

export async function insertRequest(
  db: Db,
  v: {
    displayId: string;
    clientId: string;
    title: string;
    description: string | null;
    priority: string | null;
    source: string | null;
    websiteUrl: string | null;
  },
): Promise<{ id: string; displayId: string }> {
  const { data, error } = await db
    .from("requests")
    .insert({
      display_id: v.displayId,
      client_id: v.clientId,
      title: v.title,
      description: v.description,
      priority: v.priority,
      source: v.source,
      website_url: v.websiteUrl,
    })
    .select("id,display_id")
    .single();
  if (error) fail("save the request", error);
  return { id: data.id, displayId: data.display_id };
}

export async function findTaskBySource(db: Db, sourceReference: string) {
  const { data, error } = await db
    .from("internal_work_items")
    .select("id")
    .eq("source", "internal")
    .eq("source_reference", sourceReference)
    .limit(1)
    .maybeSingle();
  if (error) fail("check for a duplicate task", error);
  return data ? { id: data.id } : null;
}

export async function insertTask(
  db: Db,
  v: {
    title: string;
    description: string | null;
    clientId: string | null;
    priority: string;
    dueDate: string | null;
    sourceReference: string;
  },
): Promise<{ id: string }> {
  const { data, error } = await db
    .from("internal_work_items")
    .insert({
      title: v.title,
      description: v.description,
      client_id: v.clientId,
      priority: v.priority,
      due_date: v.dueDate,
      source: "internal",
      source_reference: v.sourceReference,
    })
    .select("id")
    .single();
  if (error) fail("save the task", error);
  return { id: data.id };
}

export async function getTask(db: Db, id: string) {
  const { data, error } = await db
    .from("internal_work_items")
    .select("id,title,status,client_id,completed_at")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("read the task", error);
  return data;
}

export async function updateTaskStatus(db: Db, id: string, status: string, completedAt: string | null): Promise<void> {
  const { error } = await db.from("internal_work_items").update({ status, completed_at: completedAt }).eq("id", id);
  if (error) fail("update the task", error);
}

export async function listOpenTasks(db: Db, today: string): Promise<WorkTask[]> {
  const { data, error } = await db
    .from("internal_work_items")
    .select("id,title,description,client_id,status,priority,due_date,updated_at")
    .neq("status", "completed")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) fail("list tasks", error);
  const clientIds = [...new Set(data.map((t) => t.client_id).filter((v): v is string => v !== null))];
  const names = new Map<string, string>();
  if (clientIds.length > 0) {
    const clients = await db.from("clients").select("id,business_name").in("id", clientIds);
    if (clients.error) fail("read clients", clients.error);
    for (const c of clients.data) names.set(c.id, c.business_name);
  }
  return data.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    clientId: t.client_id,
    clientName: t.client_id ? (names.get(t.client_id) ?? null) : null,
    status: t.status,
    priority: t.priority,
    dueDate: t.due_date,
    overdue: t.due_date !== null && t.due_date < today,
    updatedAt: t.updated_at,
  }));
}

export async function listOpenRequests(db: Db): Promise<WorkRequest[]> {
  const { data, error } = await db
    .from("requests")
    .select("id,display_id,client_id,title,status,priority,source,created_at")
    .neq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("list requests", error);
  const clientIds = [...new Set(data.map((r) => r.client_id))];
  const names = new Map<string, string>();
  if (clientIds.length > 0) {
    const clients = await db.from("clients").select("id,business_name").in("id", clientIds);
    if (clients.error) fail("read clients", clients.error);
    for (const c of clients.data) names.set(c.id, c.business_name);
  }
  return data.map((r) => ({
    id: r.id,
    displayId: r.display_id,
    title: r.title,
    clientId: r.client_id,
    clientName: names.get(r.client_id) ?? null,
    status: r.status,
    priority: r.priority,
    source: r.source,
    createdAt: r.created_at,
  }));
}
