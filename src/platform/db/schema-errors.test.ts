import { describe, expect, it } from "vitest";
import { isUndefinedColumn, isUndefinedTable } from "./schema-errors";

describe("isUndefinedColumn", () => {
  it("matches Postgres and PostgREST errors that name the column", () => {
    expect(isUndefinedColumn({ code: "42703", message: 'column "coverage" of relation "requests" does not exist' }, "coverage")).toBe(true);
    expect(isUndefinedColumn({ code: "PGRST204", message: "Could not find the 'coverage' column of 'requests' in the schema cache" }, "coverage")).toBe(true);
  });
  it("ignores other columns, other codes and a missing error", () => {
    expect(isUndefinedColumn({ code: "42703", message: 'column "actor_name" does not exist' }, "coverage")).toBe(false);
    expect(isUndefinedColumn({ code: "23514", message: "coverage" }, "coverage")).toBe(false);
    expect(isUndefinedColumn(null, "coverage")).toBe(false);
  });
});

describe("isUndefinedTable", () => {
  it("matches a missing idempotency table", () => {
    expect(isUndefinedTable({ code: "42P01", message: 'relation "bot_idempotency_keys" does not exist' }, "bot_idempotency_keys")).toBe(true);
    expect(isUndefinedTable({ code: "PGRST205", message: "Could not find the table 'public.bot_idempotency_keys' in the schema cache" }, "bot_idempotency_keys")).toBe(true);
    expect(isUndefinedTable({ code: "42P01", message: "" }, "bot_idempotency_keys")).toBe(true);
  });
  it("does not treat a different missing table as this one", () => {
    expect(isUndefinedTable({ code: "PGRST205", message: "Could not find the table 'public.other' in the schema cache" }, "bot_idempotency_keys")).toBe(false);
    expect(isUndefinedTable({ code: "42501", message: "bot_idempotency_keys" }, "bot_idempotency_keys")).toBe(false);
  });
});
