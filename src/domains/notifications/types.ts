export interface PushDevice {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  failureCount: number;
}

export interface NotifyResult {
  sent: number;
  failed: number;
  removed: number;
  /** Why nothing was sent, when that is the case. */
  skipped: "not_configured" | "no_devices" | null;
}
