import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTargets: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  removeDevices: vi.fn(),
  sendPush: vi.fn(),
  getPushConfig: vi.fn(),
  listEndpoints: vi.fn(),
}));

vi.mock("@/platform/db/server", () => ({ createAdminClient: () => ({}), createUserClient: async () => ({}) }));
vi.mock("@/platform/audit/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("./repo", () => ({ listTargets: mocks.listTargets, recordSuccess: mocks.recordSuccess, recordFailure: mocks.recordFailure, removeDevices: mocks.removeDevices, listEndpoints: mocks.listEndpoints }));
vi.mock("@/platform/push/send", () => ({ sendPush: mocks.sendPush }));
vi.mock("@/platform/env", () => ({ getPushConfig: mocks.getPushConfig }));

import { notifyOwner, registeredFingerprints, sendTest } from "./service";
import { endpointFingerprint } from "./rules";
import { PermissionError } from "@/platform/errors";

const system = { type: "system", name: "t" } as const;
const owner = { type: "owner", userId: "u", email: null, ip: null } as const;
const payload = { title: "T", body: "B", url: "/" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPushConfig.mockReturnValue({ publicKey: "p", privateKey: "k", subject: "mailto:a@b.co" });
});

describe("notifyOwner", () => {
  it("does nothing, without error, when push is not configured", async () => {
    mocks.getPushConfig.mockReturnValue(null);
    expect(await notifyOwner(system, payload)).toEqual({ sent: 0, failed: 0, removed: 0, skipped: "not_configured" });
    expect(mocks.listTargets).not.toHaveBeenCalled();
  });
  it("reports no devices", async () => {
    mocks.listTargets.mockResolvedValue([]);
    expect((await notifyOwner(system, payload)).skipped).toBe("no_devices");
  });
  it("records successes, removes dead devices and counts other failures", async () => {
    mocks.listTargets.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    mocks.sendPush.mockResolvedValue([
      { id: "a", ok: true },
      { id: "b", ok: false, gone: true, status: 410 },
      { id: "c", ok: false, gone: false, status: 500 },
    ]);
    expect(await notifyOwner(system, payload)).toEqual({ sent: 1, failed: 1, removed: 1, skipped: null });
    expect(mocks.recordSuccess).toHaveBeenCalledWith({}, ["a"], expect.any(Date));
    expect(mocks.removeDevices).toHaveBeenCalledWith({}, ["b"]);
    expect(mocks.recordFailure).toHaveBeenCalledWith({}, ["c"]);
  });
  it("never throws if the database or the push service breaks", async () => {
    mocks.listTargets.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notifyOwner(system, payload)).toEqual({ sent: 0, failed: 0, removed: 0, skipped: null });
  });
  it("is not allowed for actors without the permission", async () => {
    await expect(notifyOwner({ type: "client" } as never, payload)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("sendTest", () => {
  it("explains why nothing was sent", async () => {
    mocks.getPushConfig.mockReturnValue(null);
    await expect(sendTest(owner)).rejects.toThrow(/VAPID/);
    mocks.getPushConfig.mockReturnValue({ publicKey: "p", privateKey: "k", subject: "mailto:a@b.co" });
    mocks.listTargets.mockResolvedValue([]);
    await expect(sendTest(owner)).rejects.toThrow(/No device/);
  });
});

describe("registeredFingerprints", () => {
  it("returns fingerprints, never the endpoint addresses", async () => {
    mocks.listEndpoints.mockResolvedValue(["https://push.example/one", "https://push.example/two"]);
    const out = await registeredFingerprints(owner);
    expect(out).toEqual([await endpointFingerprint("https://push.example/one"), await endpointFingerprint("https://push.example/two")]);
    expect(out.join(" ")).not.toContain("push.example");
  });
  it("is not allowed for actors without the permission", async () => {
    await expect(registeredFingerprints({ type: "client" } as never)).rejects.toBeInstanceOf(PermissionError);
  });
});
