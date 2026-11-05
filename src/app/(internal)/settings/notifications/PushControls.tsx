"use client";

import { useEffect, useState } from "react";
import { idle } from "@/ui/action-state";
import { BTN_PRIMARY, BTN_SMALL } from "@/ui/forms";
import { registerPushDeviceAction } from "../actions";

type Mode = "checking" | "unsupported" | "needs_install" | "denied" | "off" | "on" | "not_configured";

function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Turns notifications on or off for the device that is showing this page. */
export function PushControls({ publicKey }: { publicKey: string | null }) {
  const [mode, setMode] = useState<Mode>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Mode;
      if (!publicKey) next = "not_configured";
      else if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) next = isIos() && !isInstalled() ? "needs_install" : "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        next = sub && Notification.permission === "granted" ? "on" : "off";
      }
      if (!cancelled) setMode(next);
    })().catch(() => {
      if (!cancelled) setMode("unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMode(permission === "denied" ? "denied" : "off");
        return;
      }
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
      const json = sub.toJSON();
      const fd = new FormData();
      fd.set("endpoint", json.endpoint ?? "");
      fd.set("p256dh", json.keys?.p256dh ?? "");
      fd.set("auth", json.keys?.auth ?? "");
      const result = await registerPushDeviceAction(idle, fd);
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      setMode("on");
      setMessage("Notifications are on for this device. Use \"Send a test notification\" to check.");
    } catch (e) {
      console.error("push setup failed", e);
      setMessage("Could not turn notifications on. Check that notifications are allowed for this app in your phone settings.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      await sub?.unsubscribe();
      setMode("off");
      setMessage("Notifications are off on this device. Remove it from the list below to tidy up.");
    } catch {
      setMessage("Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  const text: Record<Mode, string> = {
    checking: "Checking this device...",
    unsupported: "This browser cannot receive push notifications.",
    needs_install: "On iPhone, notifications work only after you add Luminate OS to your Home Screen: tap Share, then Add to Home Screen, open it from the new icon, and come back to this page.",
    denied: "Notifications are blocked for this app. Allow them in your phone's settings (Settings > Notifications > Luminate OS, or the site settings in your browser), then reload this page.",
    off: "Notifications are off on this device.",
    on: "Notifications are on for this device.",
    not_configured: "Push is not set up on the server yet. Add the VAPID keys (see System status), then redeploy.",
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] leading-[1.5]">{text[mode]}</p>
      {mode === "off" && (
        <div>
          <button type="button" onClick={turnOn} disabled={busy} className={BTN_PRIMARY}>
            {busy ? "Working..." : "Turn on notifications on this device"}
          </button>
        </div>
      )}
      {mode === "on" && (
        <div>
          <button type="button" onClick={turnOff} disabled={busy} className={BTN_SMALL}>
            {busy ? "Working..." : "Turn off on this device"}
          </button>
        </div>
      )}
      {message && <p role="status" className="m-0 rounded-[10px] bg-blue-soft px-3 py-2.5 text-[13.5px] text-blue">{message}</p>}
    </div>
  );
}
