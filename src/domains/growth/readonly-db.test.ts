import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { READ_ONLY_WRITE_METHODS, ReadOnlyViolation, readOnlyClient } from "./readonly-db";

describe("readOnlyClient", () => {
  it("selects through the chain and does not call write methods", async () => {
    const insert = vi.fn();
    const update = vi.fn();
    const upsert = vi.fn();
    const del = vi.fn();
    const rpc = vi.fn();
    const rows = [{ id: "1" }];
    class Query {
      select() {
        return this;
      }
      eq() {
        return this;
      }
      gt() {
        return this;
      }
      not() {
        return this;
      }
      limit() {
        return this;
      }
      range() {
        return this;
      }
      insert(...args: unknown[]) {
        return insert(...args);
      }
      update(...args: unknown[]) {
        return update(...args);
      }
      upsert(...args: unknown[]) {
        return upsert(...args);
      }
      delete(...args: unknown[]) {
        return del(...args);
      }
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
      }
    }
    const from = vi.fn(() => new Query());
    const client = {
      from,
      insert,
      update,
      upsert,
      delete: del,
      rpc,
    };
    const db = readOnlyClient(client);
    const result = await db.from("leads").select("id").eq("id", "1").limit(1);
    expect(result.data).toEqual(rows);
    expect(from).toHaveBeenCalledWith("leads");

    for (const method of READ_ONLY_WRITE_METHODS) {
      expect(method in db).toBe(false);
      expect(Object.keys(db)).not.toContain(method);
      expect(() => (db as unknown as Record<string, () => void>)[method]!()).toThrow(ReadOnlyViolation);
    }
    const query = db.from("clients");
    for (const method of ["insert", "update", "upsert", "delete", "rpc"] as const) {
      expect(method in query).toBe(false);
      expect(() => (query as unknown as Record<string, () => void>)[method]!()).toThrow(ReadOnlyViolation);
    }
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws on a real client builder without sending the write", () => {
    const real = createClient("http://127.0.0.1:54321", "test-service-role-key-not-real");
    const db = readOnlyClient(real);
    const query = db.from("leads") as unknown as Record<string, (value?: unknown) => void>;
    expect(() => query.insert!({})).toThrow(ReadOnlyViolation);
    expect(() => query.update!({})).toThrow(ReadOnlyViolation);
    expect(() => query.upsert!({})).toThrow(ReadOnlyViolation);
    expect(() => query.delete!()).toThrow(ReadOnlyViolation);
    expect(() => (db as unknown as { rpc: (name: string) => void }).rpc("backfill_write")).toThrow(ReadOnlyViolation);
    expect("insert" in db).toBe(false);
    expect("rpc" in db).toBe(false);
  });
});
