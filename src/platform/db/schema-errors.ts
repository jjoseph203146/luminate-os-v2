// Recognises "this column/table is not in the database yet" from Postgres and PostgREST.
// Used so a migration that is not applied yet fails closed, or skips only the new column.

export interface DbErrorLike {
  code?: string;
  message?: string;
}

/** Postgres 42703 or PostgREST PGRST204, and the message names the column. */
export function isUndefinedColumn(error: DbErrorLike | null | undefined, column: string): boolean {
  if (!error) return false;
  if (error.code !== "42703" && error.code !== "PGRST204") return false;
  return (error.message ?? "").toLowerCase().includes(column.toLowerCase());
}

/**
 * Postgres 42P01 or PostgREST PGRST205 (schema cache), and the message names the table.
 * A bare 42P01 with no message still counts: the caller asked about one table.
 */
export function isUndefinedTable(error: DbErrorLike | null | undefined, table: string): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  const namesIt = message.includes(table.toLowerCase());
  if (error.code === "42P01" || error.code === "PGRST205") return namesIt || message.length === 0;
  if (/schema cache|does not exist|could not find the table/i.test(error.message ?? "")) return namesIt;
  return false;
}
