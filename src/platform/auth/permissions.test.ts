import { describe, expect, it } from "vitest";
import { PermissionError } from "@/platform/errors";
import { assertCan, can, PERMISSIONS } from "./permissions";
import type { Actor } from "./types";

const owner: Actor = { type: "owner", userId: "u1", email: "o@example.com", ip: null };
const system: Actor = { type: "system", name: "jobs" };

describe("permissions", () => {
  it("gives the owner everything", () => {
    for (const p of PERMISSIONS) expect(can(owner, p)).toBe(true);
  });
  it("limits the system actor to running and reading jobs", () => {
    expect(can(system, "jobs.run")).toBe(true);
    expect(can(system, "jobs.read")).toBe(true);
    expect(can(system, "settings.write")).toBe(false);
    expect(can(system, "users.manage")).toBe(false);
    expect(can(system, "audit.read")).toBe(false);
  });
  it("throws PermissionError when not allowed", () => {
    expect(() => assertCan(system, "settings.write")).toThrow(PermissionError);
    expect(() => assertCan(owner, "settings.write")).not.toThrow();
  });
});

describe("the ai actor", () => {
  const ai: Actor = { type: "ai", name: "mcp" };
  it("can read what the assistant tools need, including the time zone", () => {
    for (const p of ["assistant.read", "clients.read", "work.read", "growth.read", "monitoring.read", "calendar.read"] as const) expect(can(ai, p)).toBe(true);
  });
  it("cannot read Settings, write anything, run jobs, send pushes or see the audit log or users", () => {
    for (const p of ["settings.read", "settings.write", "work.write", "leads.write", "notes.write", "growth.write", "users.manage", "audit.read", "jobs.run", "jobs.read", "notifications.send", "notifications.manage", "system.read", "growth.intake", "alerts.run", "billing.tasks", "billing.ingest", "clients.write", "money.read", "dashboard.read"] as const) {
      expect(can(ai, p)).toBe(false);
    }
  });
});

describe("the bot actor", () => {
  const bot: Actor = { type: "bot", name: "daily-crm", ip: null };
  it("may write leads, notes and work, and nothing else", () => {
    expect(can(bot, "leads.write")).toBe(true);
    expect(can(bot, "notes.write")).toBe(true);
    expect(can(bot, "work.write")).toBe(true);
    for (const p of PERMISSIONS) {
      if (p === "leads.write" || p === "notes.write" || p === "work.write") continue;
      expect(can(bot, p)).toBe(false);
    }
  });
  it("cannot delete leads, touch money, or use the read-only assistant permission", () => {
    expect(can(bot, "growth.write")).toBe(false);
    expect(can(bot, "billing.tasks")).toBe(false);
    expect(can(bot, "billing.ingest")).toBe(false);
    expect(can(bot, "billing.invoice_send")).toBe(false);
    expect(can(bot, "clients.write")).toBe(false);
    expect(can(bot, "assistant.read")).toBe(false);
    expect(can(bot, "dashboard.read")).toBe(false);
    expect(can(bot, "money.read")).toBe(false);
    expect(() => assertCan(bot, "growth.write")).toThrow(PermissionError);
  });
});

describe("monitoring.scan", () => {
  it("is for the system actor (the scheduled job) and the owner only", () => {
    expect(can({ type: "system", name: "site_checks" }, "monitoring.scan")).toBe(true);
    expect(can({ type: "owner", userId: "u", email: null, ip: null }, "monitoring.scan")).toBe(true);
    expect(can({ type: "ai", name: "mcp" }, "monitoring.scan")).toBe(false);
    expect(can({ type: "client" } as never, "monitoring.scan")).toBe(false);
  });
});

describe("the integration actor (the Stripe webhook)", () => {
  const stripe: Actor = { type: "integration", name: "stripe" };
  it("may ingest billing events and nothing else", () => {
    expect(can(stripe, "billing.ingest")).toBe(true);
    for (const p of PERMISSIONS.filter((x) => x !== "billing.ingest")) expect(can(stripe, p)).toBe(false);
  });
  it("no other machine actor may ingest billing events", () => {
    expect(can({ type: "system", name: "jobs" }, "billing.ingest")).toBe(false);
    expect(can({ type: "ai", name: "mcp" }, "billing.ingest")).toBe(false);
  });
});
