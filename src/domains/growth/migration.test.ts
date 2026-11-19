import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../supabase/migrations/0011_lead_pipeline.sql", import.meta.url), "utf8");
const previous = readFileSync(new URL("../../../supabase/migrations/0010_bot_writes.sql", import.meta.url), "utf8");

describe("migration 0011", () => {
  it("adds the pipeline columns, the activity log, and note history", () => {
    for (const column of ["client_id", "stage_changed_at", "last_touch_at", "next_step", "next_step_on", "lost_reason", "kind", "campaign"]) {
      expect(sql).toContain(`add column if not exists ${column}`);
    }
    expect(sql).toContain("create table if not exists public.lead_activities");
    expect(sql).toContain("create table if not exists public.client_note_revisions");
    expect(sql).toContain("on delete set null");
    expect(sql).toContain("previous_content");
  });

  it("does not change the v1 lead status check", () => {
    const statements = sql.toLowerCase().replace(/--[^\n]*/g, "");
    expect(statements).not.toMatch(/drop constraint[^;]*leads_status_check/);
    expect(statements).not.toMatch(/add constraint leads_status_check/);
    expect(previous).toContain("bot_idempotency_keys");
  });

  it("says it has not been applied and does not run the backfill", () => {
    expect(sql).toContain("NOT APPLIED");
    expect(sql.toLowerCase()).not.toContain("insert into public.clients");
    expect(sql.toLowerCase()).not.toContain("insert into public.leads");
  });
});
