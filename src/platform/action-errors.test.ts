import { describe, expect, it } from "vitest";
import { formToObject, toActionError } from "./action-errors";
import { PermissionError, RateLimitError, RuleError, ValidationError } from "./errors";
import { AuditWriteError } from "./audit/audit";
import { EnvError } from "./env";

describe("toActionError", () => {
  it("shows messages from our own error types", () => {
    expect(toActionError(new ValidationError(["a: bad", "b: worse"]))).toBe("a: bad b: worse");
    expect(toActionError(new RuleError("Nope."))).toBe("Nope.");
    expect(toActionError(new PermissionError())).toMatch(/permission/);
    expect(toActionError(new AuditWriteError())).toMatch(/audit/);
  });
  it("does not leak details of unexpected errors", () => {
    expect(toActionError(new Error("connection string postgres://secret"))).toBe("Something went wrong. Please try again.");
    expect(toActionError(new EnvError(["SUPABASE_SERVICE_ROLE_KEY"]))).not.toContain("SERVICE_ROLE");
  });
});

describe("formToObject", () => {
  it("keeps single values and collects repeated ones", () => {
    const fd = new FormData();
    fd.append("name", "x");
    fd.append("workingDays", "0");
    fd.append("workingDays", "1");
    expect(formToObject(fd)).toEqual({ name: "x", workingDays: ["0", "1"] });
  });
  it("ignores file entries", () => {
    const fd = new FormData();
    fd.append("f", new Blob(["x"]), "x.txt");
    expect(formToObject(fd)).toEqual({ f: "" });
  });
});

describe("toActionError: rate limits", () => {
  it("shows a rate-limit message instead of the generic error", () => {
    expect(toActionError(new RateLimitError("You just ran several scans. Wait a minute and try again."))).toBe("You just ran several scans. Wait a minute and try again.");
  });
});
