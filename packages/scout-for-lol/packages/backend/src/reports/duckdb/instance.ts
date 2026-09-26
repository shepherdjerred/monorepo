import type * as DuckDBModuleNamespace from "@duckdb/node-api";
import type { DuckDBInstance, DuckDBValue } from "@duckdb/node-api";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("duckdb");

/**
 * Embedded DuckDB lifecycle for the report lake.
 *
 * - The NAPI module is loaded lazily via dynamic import (same pattern as
 *   @resvg/resvg-js in the report package) so bot startup and hot paths
 *   never pay for it.
 * - One process-wide in-memory instance amortizes startup; every query gets
 *   its own connection because interrupt() is per-connection — one preview's
 *   timeout must not cancel another's query.
 * - threads / memory_limit are capped so analytical queries can't starve the
 *   Discord event loop or the pod.
 */

export class ReportQueryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Report query timed out after ${timeoutMs.toString()}ms`);
    this.name = "ReportQueryTimeoutError";
  }
}

/**
 * Generous on purpose: Explore and reports answer open questions over the
 * whole lake, and a slow correct answer beats a fast refusal.
 */
export const DEFAULT_QUERY_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_REPORT_QUERIES = 2;

export type DuckDBSession = {
  /** Run a statement and return its rows as unvalidated objects. */
  run: (sql: string, params?: DuckDBValue[]) => Promise<unknown[]>;
  /** Wrap a JS array as a DuckDB LIST bind value (for IN (SELECT unnest($1))). */
  list: (values: string[] | number[]) => DuckDBValue;
};

type DuckDBModule = typeof DuckDBModuleNamespace;

let modulePromise: Promise<DuckDBModule> | undefined;

async function loadDuckDB(): Promise<DuckDBModule> {
  modulePromise ??= import("@duckdb/node-api");
  return await modulePromise;
}

let instancePromise: Promise<DuckDBInstance> | undefined;

type SemaphoreWaiter = {
  token: object;
  resolve: () => void;
};

class AsyncSemaphore {
  #active = 0;
  readonly #waiters: SemaphoreWaiter[] = [];

  constructor(readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted === true) {
      throw new DOMException("DuckDB query aborted.", "AbortError");
    }

    if (this.#active < this.limit) {
      this.#active++;
    } else {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const waiterToken = {};
        const onAbort = () => {
          if (settled) return;
          settled = true;
          const index = this.#waiters.findIndex(
            (waiter) => waiter.token === waiterToken,
          );
          if (index !== -1) this.#waiters.splice(index, 1);
          reject(new DOMException("DuckDB query aborted.", "AbortError"));
        };
        const waiter: SemaphoreWaiter = {
          token: waiterToken,
          resolve: () => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        this.#waiters.push(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted === true) onAbort();
      });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiters.shift();
      if (next === undefined) {
        this.#active--;
      } else {
        // Hand the existing slot directly to the next waiter.
        next.resolve();
      }
    };
  }
}

const reportQuerySemaphore = new AsyncSemaphore(MAX_CONCURRENT_REPORT_QUERIES);

async function getInstance(): Promise<DuckDBInstance> {
  instancePromise ??= (async () => {
    const duckdb = await loadDuckDB();
    // Widened to unknown to survive partial test mocks of the configuration
    // module (a former process-wide Bun mock leaked here; see auth-web.test.ts);
    // real runs always have the env-var defaults.
    const configuredThreads: unknown = configuration.reportDuckDbThreads;
    const configuredMemory: unknown = configuration.reportDuckDbMemoryLimit;
    const threads = (
      typeof configuredThreads === "number" ? configuredThreads : 4
    ).toString();
    const memoryLimit =
      typeof configuredMemory === "string" ? configuredMemory : "3GB";
    const configuredTempDir: unknown = configuration.reportDuckDbTempDir;
    const configuredMaxTemp: unknown = configuration.reportDuckDbMaxTempSize;
    // A query larger than memory_limit spills here instead of failing.
    const spill =
      typeof configuredTempDir === "string"
        ? {
            temp_directory: configuredTempDir,
            max_temp_directory_size:
              typeof configuredMaxTemp === "string"
                ? configuredMaxTemp
                : "7GiB",
          }
        : {};
    logger.info(
      `Creating DuckDB instance (threads=${threads}, memory_limit=${memoryLimit}, temp_directory=${spill.temp_directory ?? "none"})`,
    );
    return await duckdb.DuckDBInstance.create(":memory:", {
      threads,
      memory_limit: memoryLimit,
      preserve_insertion_order: "false",
      ...spill,
    });
  })();
  return await instancePromise;
}

/**
 * Run `fn` with a fresh connection. Every statement issued through the
 * session shares one timeout budget; when it expires the connection is
 * interrupted and a ReportQueryTimeoutError is thrown.
 */
export async function withDuckDBConnection<T>(
  fn: (session: DuckDBSession) => Promise<T>,
  options: { timeoutMs?: number; abortSignal?: AbortSignal } = {},
): Promise<T> {
  const release = await reportQuerySemaphore.acquire(options.abortSignal);
  try {
    return await withDuckDBConnectionSlot(fn, options);
  } finally {
    release();
  }
}

async function withDuckDBConnectionSlot<T>(
  fn: (session: DuckDBSession) => Promise<T>,
  options: { timeoutMs?: number; abortSignal?: AbortSignal },
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const duckdb = await loadDuckDB();
  const instance = await getInstance();
  const connection = await instance.connect();

  const timeoutState = { timedOut: false, aborted: false };
  const hasTimedOut = () => timeoutState.timedOut;
  const abort = () => {
    timeoutState.aborted = true;
    connection.interrupt();
  };
  const timer = setTimeout(() => {
    timeoutState.timedOut = true;
    connection.interrupt();
  }, timeoutMs);

  if (timeoutMs <= 0) {
    timeoutState.timedOut = true;
    connection.interrupt();
  }
  options.abortSignal?.addEventListener("abort", abort, { once: true });
  if (options.abortSignal?.aborted === true) {
    abort();
  }

  const session: DuckDBSession = {
    run: async (sql, params) => {
      if (hasTimedOut()) {
        throw new ReportQueryTimeoutError(timeoutMs);
      }
      try {
        const reader = await connection.runAndReadAll(sql, params);
        return reader.getRowObjects();
      } catch (error) {
        if (timeoutState.aborted) {
          throw new DOMException("DuckDB query aborted.", "AbortError");
        }
        if (hasTimedOut()) {
          throw new ReportQueryTimeoutError(timeoutMs);
        }
        throw error;
      }
    },
    list: (values) => duckdb.listValue(values),
  };

  try {
    return await fn(session);
  } finally {
    clearTimeout(timer);
    options.abortSignal?.removeEventListener("abort", abort);
    connection.closeSync();
  }
}

/**
 * Release the process-wide instance.
 *
 * The server never calls this: the instance is meant to live as long as the
 * process, and connections are already closed per query. A CLI is the other
 * case — left open, the native instance is only released by finalization,
 * which measurably delays exit after the work is done. Idempotent, and a
 * later query simply creates a new instance.
 */
export async function closeDuckDB(): Promise<void> {
  const pending = instancePromise;
  if (pending === undefined) return;
  instancePromise = undefined;
  const instance = await pending;
  instance.closeSync();
}
