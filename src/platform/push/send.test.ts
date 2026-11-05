import { describe, expect, it, vi } from "vitest";
import { isGone, sendPush } from "./send";

const config = { publicKey: "p".repeat(60), privateKey: "k".repeat(30), subject: "mailto:a@b.co" };
const target = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "x", auth: "y" });
const payload = { title: "T", body: "B", url: "/growth", tag: "t" };

describe("sendPush", () => {
  it("sends the JSON payload to every target and reports success", async () => {
    const send = vi.fn().mockResolvedValue({});
    const r = await sendPush(config, [target("a"), target("b")], payload, send);
    expect(r).toEqual([{ id: "a", ok: true }, { id: "b", ok: true }]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[0]![1] as string)).toEqual(payload);
  });
  it("marks 404 and 410 as gone, other failures as not gone", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("x"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("x"), { statusCode: 500 }))
      .mockRejectedValueOnce(new Error("network"));
    const r = await sendPush(config, [target("a"), target("b"), target("c")], payload, send);
    expect(r).toEqual([
      { id: "a", ok: false, gone: true, status: 410 },
      { id: "b", ok: false, gone: false, status: 500 },
      { id: "c", ok: false, gone: false, status: null },
    ]);
  });
  it("one failing device does not stop the others", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({});
    const r = await sendPush(config, [target("a"), target("b")], payload, send);
    expect(r.map((x) => x.ok)).toEqual([false, true]);
  });
});
describe("isGone", () => {
  it("is true only for 404 and 410", () => {
    expect([404, 410, 400, 401, 403, 500, null].map(isGone)).toEqual([true, true, false, false, false, false, false]);
  });
});
