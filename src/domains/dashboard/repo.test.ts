import { describe, expect, it } from "vitest";
import { CLIENT_READ_COLUMNS, isClientSchemaMiss, isLeadSchemaMiss, isPaymentSchemaMiss, isPipelineColumnMiss, isUndefinedColumnError, LEAD_BASE_COLUMNS, LEAD_PIPELINE_COLUMNS, PAYMENT_READ_COLUMNS } from "./repo";

const BANNED = ["email", "phone", "notes", "contact_name", "name"];

describe("dashboard reads", () => {
  it("does not select emails, phones, contact names or notes", () => {
    for (const columns of [LEAD_BASE_COLUMNS, LEAD_PIPELINE_COLUMNS, CLIENT_READ_COLUMNS, PAYMENT_READ_COLUMNS]) {
      for (const banned of BANNED) expect(columns.split(",")).not.toContain(banned);
    }
    expect(LEAD_PIPELINE_COLUMNS.split(",")).toEqual(["client_id", "stage_changed_at", "last_touch_at", "next_step", "next_step_on", "lost_reason", "kind"]);
    expect(PAYMENT_READ_COLUMNS.split(",")).toEqual(["amount", "status", "paid_at", "client_id"]);
  });

  it("tells a missing pipeline column apart from a missing leads table", () => {
    const pipeline = { code: "PGRST204", message: "Could not find the 'next_step_on' column of 'leads' in the schema cache" };
    expect(isPipelineColumnMiss(pipeline)).toBe(true);
    expect(isUndefinedColumnError(pipeline)).toBe(true);
    expect(isLeadSchemaMiss(pipeline)).toBe(false);
    expect(isLeadSchemaMiss({ code: "42703", message: 'column "estimated_value" of relation "leads" does not exist' })).toBe(true);
    expect(isLeadSchemaMiss({ code: "PGRST205", message: "Could not find the table 'public.leads' in the schema cache" })).toBe(true);
    expect(isPipelineColumnMiss({ code: "42703", message: 'column "email" does not exist' })).toBe(false);
    const clientId = { code: "42703", message: 'column "client_id" of relation "leads" does not exist' };
    expect(isPipelineColumnMiss(clientId)).toBe(true);
    expect(isLeadSchemaMiss(clientId)).toBe(false);
  });

  it("treats a missing clients or revenue_events relation as unavailable", () => {
    expect(isClientSchemaMiss({ code: "42P01", message: 'relation "public.clients" does not exist' })).toBe(true);
    expect(isClientSchemaMiss({ code: "42703", message: 'column "lifetime_value" does not exist' })).toBe(true);
    expect(isClientSchemaMiss({ code: "42703", message: 'column "email" does not exist' })).toBe(false);
    expect(isPaymentSchemaMiss({ code: "PGRST205", message: "Could not find the table 'public.revenue_events' in the schema cache" })).toBe(true);
    expect(isPaymentSchemaMiss({ code: "42703", message: 'column "paid_at" of relation "revenue_events" does not exist' })).toBe(true);
    expect(isPaymentSchemaMiss(null)).toBe(false);
  });
});
