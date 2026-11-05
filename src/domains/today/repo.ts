// Database access for the Today screen. Read-only, owner session (row-level security applies).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AttentionInput, ClientRow, MonitorInput, PaymentRow, ProjectRow, RequestRow, TaskRow } from "./rules";

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

export async function loadTodayInputs(db: Db, since: string): Promise<AttentionInput> {
  const [clients, monitors, requests, tasks, projects, payments] = await Promise.all([
    db
      .from("clients")
      .select("id,business_name,status,subscription_price,archived_at,monitoring_paused_at")
      .is("archived_at", null)
      .limit(1000),
    db
      .from("site_monitors")
      .select("client_id,status,url,last_checked_at,http_status,response_time_ms,ssl_expires_at,domain_expires_at")
      .limit(1000),
    db
      .from("requests")
      .select("id,client_id,display_id,title,status,created_at,updated_at")
      .neq("status", "completed")
      .order("created_at", { ascending: true })
      .limit(300),
    db
      .from("internal_work_items")
      .select("id,client_id,title,status,priority,due_date,updated_at")
      .neq("status", "completed")
      .limit(300),
    db.from("projects").select("id,client_id,name,blocker_note,updated_at").not("blocker_note", "is", null).limit(100),
    db
      .from("revenue_events")
      .select("id,client_id,amount,status,paid_at,created_at")
      .or(`created_at.gte.${since},paid_at.gte.${since}`)
      .limit(1000),
  ]);
  return {
    clients: must("read clients", clients) as ClientRow[],
    monitors: must("read monitoring", monitors) as MonitorInput[],
    requests: must("read requests", requests) as RequestRow[],
    tasks: must("read tasks", tasks) as TaskRow[],
    projects: must("read projects", projects) as ProjectRow[],
    payments: must("read payments", payments) as PaymentRow[],
  };
}
