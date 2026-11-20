// The only data access preview is given. Four reads, closed over a client that throws on write.
// loadWonBackfillPlan takes this object, so it cannot call insert, update, upsert, delete, or rpc.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { blockWriteMethods, readOnlyClient } from "./readonly-db";
import * as repo from "./repo";

export interface BackfillReadAccess {
  pipelineReady(): Promise<boolean>;
  listClientCandidates(): Promise<repo.ClientCandidateRow[]>;
  listPaidClientIds(): Promise<Set<string>>;
  listLeadsForBackfill(): Promise<repo.BackfillLeadRow[]>;
}

export function createBackfillReadAccess(client: SupabaseClient<Database>): BackfillReadAccess {
  const db = readOnlyClient(client);
  const reads: BackfillReadAccess = {
    pipelineReady: () => repo.pipelineReady(db),
    listClientCandidates: () => repo.listClientCandidates(db),
    listPaidClientIds: () => repo.listPaidClientIds(db),
    listLeadsForBackfill: () => repo.listLeadsForBackfill(db),
  };
  return blockWriteMethods(reads);
}
