import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time check of the scheduler's bearer secret. */
export function tickAuthorized(authorizationHeader: string | null, secret: string): boolean {
  const a = createHash("sha256").update(authorizationHeader ?? "").digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
