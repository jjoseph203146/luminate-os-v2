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
