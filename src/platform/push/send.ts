// Sends Web Push messages. No database here: the notifications service decides who gets what.
import webpush from "web-push";
import type { PushConfig } from "@/platform/env";

export interface PushPayload {
  title: string;
  body: string;
  /** Same-site path opened when the notification is tapped. */
  url: string;
  /** A newer notification with the same tag replaces the older one on the phone. */
  tag?: string;
}

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = { id: string; ok: true } | { id: string; ok: false; gone: boolean; status: number | null };

type SendFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

/** 404 and 410 mean the phone or browser has dropped the subscription for good. */
export function isGone(status: number | null): boolean {
  return status === 404 || status === 410;
}

export async function sendPush(
  config: PushConfig,
  targets: PushTarget[],
  payload: PushPayload,
  send: SendFn = (s, p, o) => webpush.sendNotification(s, p, o),
): Promise<PushResult[]> {
  const body = JSON.stringify(payload);
  return Promise.all(
    targets.map(async (t): Promise<PushResult> => {
      try {
        await send({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, body, {
          vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          TTL: 60 * 60 * 24,
          urgency: "high",
          timeout: 8000,
        });
        return { id: t.id, ok: true };
      } catch (e) {
        const status = typeof (e as { statusCode?: unknown }).statusCode === "number" ? (e as { statusCode: number }).statusCode : null;
        return { id: t.id, ok: false, gone: isGone(status), status };
      }
    }),
  );
}
