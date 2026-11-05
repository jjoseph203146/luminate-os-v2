// Turns thrown errors into messages that are safe to show on screen.
import { PermissionError, RuleError, ValidationError } from "@/platform/errors";
import { AuditWriteError } from "@/platform/audit/audit";
import { EnvError } from "@/platform/env";

export function toActionError(e: unknown): string {
  if (e instanceof ValidationError) return e.issues.join(" ");
  if (e instanceof PermissionError || e instanceof RuleError || e instanceof AuditWriteError) return e.message;
  if (e instanceof EnvError) return "The server is not fully configured. See System status.";
  return "Something went wrong. Please try again.";
}

/** Reads a FormData into a plain object; repeated fields become arrays. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}
