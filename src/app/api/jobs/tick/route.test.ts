import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tick: vi.fn(), after: vi.fn(), secret: "s".repeat(40) as string | null }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/domains/automation/service", () => ({ tick: mocks.tick }));
vi.mock("@/platform/env", () => ({ getCronSecret: () => mocks.secret }));

import { GET, POST } from "./route";

const req = (auth?: string) => new Request("https://www.luminateos.app/api/jobs/tick", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.secret = "s".repeat(40);
  mocks.tick.mockResolvedValue({ at: "x", outcomes: [] });
});

describe("/api/jobs/tick", () => {
  it("answers 202 at once and runs the jobs after the response, so a scheduler's short wait never times out", async () => {
    const res = await GET(req(`Bearer ${"s".repeat(40)}`));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(mocks.tick).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.tick).toHaveBeenCalledWith({ type: "system", name: "scheduler" });
  });
  it("a failing tick after the response is logged, not thrown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.tick.mockRejectedValue(new Error("db down"));
    await POST(req(`Bearer ${"s".repeat(40)}`));
    await expect(mocks.after.mock.calls[0]![0]()).resolves.toBeUndefined();
  });
  it("refuses a wrong or missing secret, and says when the scheduler is not configured", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req())).status).toBe(401);
    mocks.secret = null;
    expect((await GET(req(`Bearer ${"s".repeat(40)}`))).status).toBe(503);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
