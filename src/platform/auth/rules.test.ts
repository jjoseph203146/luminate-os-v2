import { describe, expect, it } from "vitest";
import { isMfaRequired, isPublicPath, mfaGate, roleToActorType, safeNextPath } from "./rules";

describe("roleToActorType", () => {
  it("maps admin to owner and client to client", () => {
    expect(roleToActorType("admin")).toBe("owner");
    expect(roleToActorType("client")).toBe("client");
  });
  it("gives no access for anything else", () => {
    expect(roleToActorType("none")).toBeNull();
    expect(roleToActorType("")).toBeNull();
    expect(roleToActorType(null)).toBeNull();
    expect(roleToActorType(undefined)).toBeNull();
    expect(roleToActorType("owner")).toBeNull();
  });
});

describe("mfaGate", () => {
  it("lets everyone in when MFA is not required", () => {
    expect(mfaGate({ required: false, currentLevel: "aal1", nextLevel: "aal2" })).toBe("ok");
    expect(mfaGate({ required: false, currentLevel: "aal1", nextLevel: "aal1" })).toBe("ok");
  });
  it("lets an aal2 session in", () => {
    expect(mfaGate({ required: true, currentLevel: "aal2", nextLevel: "aal2" })).toBe("ok");
  });
  it("asks for a code when an authenticator exists", () => {
    expect(mfaGate({ required: true, currentLevel: "aal1", nextLevel: "aal2" })).toBe("challenge");
  });
  it("asks to enroll when there is no authenticator", () => {
    expect(mfaGate({ required: true, currentLevel: "aal1", nextLevel: "aal1" })).toBe("enroll");
    expect(mfaGate({ required: true, currentLevel: null, nextLevel: null })).toBe("enroll");
  });
});

describe("isMfaRequired", () => {
  it("follows the switch alone, in production too (owner decision 2026-11-05)", () => {
    expect(isMfaRequired("production", false)).toBe(false);
    expect(isMfaRequired("production", true)).toBe(true);
  });
  it("follows the switch elsewhere", () => {
    expect(isMfaRequired("staging", false)).toBe(false);
    expect(isMfaRequired("local", false)).toBe(false);
    expect(isMfaRequired("staging", true)).toBe(true);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/settings/users")).toBe("/settings/users");
    expect(safeNextPath("/settings/audit-log?page=2")).toBe("/settings/audit-log?page=2");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "javascript:alert(1)", "/a\nb"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
  it("falls back to the home page when empty or looping to login", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/login?next=/x")).toBe("/");
  });
});

describe("isPublicPath", () => {
  it("allows sign-in related pages and the job tick", () => {
    for (const p of ["/login", "/forgot-password", "/session-expired", "/auth/confirm", "/api/jobs/tick", "/manifest.webmanifest", "/sw.js", "/logo.png", "/icons/icon-192.png", "/api/leads/create"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });
  it("requires a session for everything else", () => {
    for (const p of ["/", "/settings", "/settings/users", "/reset-password", "/mfa/enroll", "/mfa/challenge", "/access-denied", "/automations", "/api/jobs/other"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
