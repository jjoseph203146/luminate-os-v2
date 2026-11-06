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
    for (const p of ["settings.read", "settings.write", "work.write", "users.manage", "audit.read", "jobs.run", "jobs.read", "notifications.send", "notifications.manage", "system.read", "growth.intake", "alerts.run"] as const) {
      expect(can(ai, p)).toBe(false);
    }
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
