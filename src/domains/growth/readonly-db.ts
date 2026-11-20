// A Supabase client that can select and nothing else. Preview builds its plan
// through this object. insert, update, upsert, delete, and rpc are not methods:
// reading the name throws, so a later edit cannot write by accident.

const WRITE_METHODS = ["insert", "update", "upsert", "delete", "rpc"] as const;

export type WriteMethod = (typeof WRITE_METHODS)[number];

export const READ_ONLY_WRITE_METHODS: readonly WriteMethod[] = WRITE_METHODS;

export class ReadOnlyViolation extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`READ ONLY, nothing written. ${method} is not available.`);
    this.name = "ReadOnlyViolation";
    this.method = method;
  }
}

export interface ReadResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
}

/** The filter chain a preview is allowed to run. There is no insert, update, upsert, or delete. */
export interface ReadOnlyFilter extends PromiseLike<ReadResult> {
  select(columns?: string, options?: unknown): ReadOnlyFilter;
  eq(column: string, value: unknown): ReadOnlyFilter;
  gt(column: string, value: unknown): ReadOnlyFilter;
  gte(column: string, value: unknown): ReadOnlyFilter;
  not(column: string, operator: string, value: unknown): ReadOnlyFilter;
  order(column: string, options?: unknown): ReadOnlyFilter;
  limit(count: number): ReadOnlyFilter;
  range(from: number, to: number): ReadOnlyFilter;
  is(column: string, value: unknown): ReadOnlyFilter;
  maybeSingle(): PromiseLike<ReadResult>;
}

/** The database handle preview is allowed to hold. `rpc` is not on this type. */
export interface ReadOnlyDb {
  from(table: string): ReadOnlyFilter;
}

function isWriteMethod(prop: PropertyKey): prop is WriteMethod {
  return typeof prop === "string" && (WRITE_METHODS as readonly string[]).includes(prop);
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function rejectWrite(method: string): () => never {
  return () => {
    throw new ReadOnlyViolation(method);
  };
}

type Thenable = {
  then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => unknown;
};

function wrap(target: object): object {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (isWriteMethod(prop)) return rejectWrite(prop);
      if (prop === "from") {
        const original = Reflect.get(obj, prop, receiver);
        if (typeof original !== "function") return () => wrap({});
        return (table: unknown) => {
          const query = (original as (table: unknown) => unknown).call(obj, table);
          return wrap(isObject(query) ? query : {});
        };
      }
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "then") {
        const then = value as Thenable["then"];
        return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => then.call(obj, onFulfilled, onRejected);
      }
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
        return isObject(result) ? wrap(result) : result;
      };
    },
    has(obj, prop) {
      if (isWriteMethod(prop)) return false;
      return Reflect.has(obj, prop);
    },
    getOwnPropertyDescriptor(obj, prop) {
      if (isWriteMethod(prop)) {
        const current = Reflect.getOwnPropertyDescriptor(obj, prop);
        if (current && current.configurable === false) return current;
        return undefined;
      }
      return Reflect.getOwnPropertyDescriptor(obj, prop);
    },
    ownKeys(obj) {
      return Reflect.ownKeys(obj).filter((key) => {
        if (!isWriteMethod(key)) return true;
        const current = Reflect.getOwnPropertyDescriptor(obj, key);
        return Boolean(current && current.configurable === false);
      });
    },
    set(_obj, prop) {
      throw new ReadOnlyViolation(typeof prop === "string" ? prop : "write");
    },
  });
}

/** Wraps a service-role client. Selects run. Writes throw before the underlying client is called. */
export function readOnlyClient(client: object): ReadOnlyDb {
  return wrap(client) as ReadOnlyDb;
}

/**
 * The object preview passes into the plan. Its own methods are the reads.
 * insert, update, upsert, delete, and rpc are absent, and calling any of them throws.
 */
export function blockWriteMethods<T extends object>(value: T): T {
  return new Proxy(value, {
    get(obj, prop, receiver) {
      if (isWriteMethod(prop)) return rejectWrite(prop);
      return Reflect.get(obj, prop, receiver);
    },
    has(obj, prop) {
      if (isWriteMethod(prop)) return false;
      return Reflect.has(obj, prop);
    },
    getOwnPropertyDescriptor(obj, prop) {
      if (isWriteMethod(prop)) return undefined;
      return Reflect.getOwnPropertyDescriptor(obj, prop);
    },
    ownKeys(obj) {
      return Reflect.ownKeys(obj).filter((key) => !isWriteMethod(key));
    },
    set(_obj, prop) {
      throw new ReadOnlyViolation(typeof prop === "string" ? prop : "write");
    },
  }) as T;
}
