// A small in-memory limiter: at most `max` hits per key in a sliding window.
// It lives in one server instance, so it slows bursts but is not a global guarantee;
// the contact-form service also applies a database-backed hourly cap.

export interface RateLimiter {
  /** Returns true if this hit is allowed (and counts it), false if the key is over its limit. */
  check(key: string, now: number): boolean;
}

export function createRateLimiter(options: { max: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { max, windowMs, maxKeys = 5000 } = options;
  const hits = new Map<string, number[]>();
  return {
    check(key, now) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) {
          if (v.every((t) => now - t >= windowMs)) hits.delete(k);
          if (hits.size <= maxKeys) break;
        }
      }
      return true;
    },
  };
}
