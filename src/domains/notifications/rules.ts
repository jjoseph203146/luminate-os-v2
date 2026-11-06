// Pure helpers for notifications.

/** A short device name for the list, from the browser's user-agent string. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux|CrOS/i.test(ua)) return "Linux or Chromebook";
  return "Browser";
}

/** Notification text must stay short: phones cut it off, and push payloads are capped near 4 KB. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Do two push public keys match? A browser subscription is tied to the key it was made with, so a
 * subscription made by another app on the same address (for example the old Luminate OS) cannot
 * receive messages signed with this app's key.
 */
export function sameKey(a: ArrayBuffer | ArrayBufferView | null | undefined, b: ArrayBuffer | ArrayBufferView): boolean {
  if (!a) return false;
  const x = a instanceof ArrayBuffer ? new Uint8Array(a) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (x.length !== y.length) return false;
  return x.every((v, i) => v === y[i]);
}

/**
 * A short, non-reversible id for a push endpoint, so the page can tell whether this browser is
 * registered without sending the endpoint addresses themselves to the browser. Same result in the
 * browser and on the server (Web Crypto).
 */
export async function endpointFingerprint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
