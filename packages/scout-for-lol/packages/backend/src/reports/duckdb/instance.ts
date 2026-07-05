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

export const DEFAULT_QUERY_TIMEOUT_MS = 15_000;

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

async function getInstance(): Promise<DuckDBInstance> {
  instancePromise ??= (async () => {
    const duckdb = await loadDuckDB();
    logger.info(
      `Creating DuckDB instance (threads=${configuration.reportDuckDbThreads.toString()}, memory_limit=${configuration.reportDuckDbMemoryLimit})`,
    );
    return await duckdb.DuckDBInstance.create(":memory:", {
      threads: configuration.reportDuckDbThreads.toString(),
      memory_limit: configuration.reportDuckDbMemoryLimit,
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
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const duckdb = await loadDuckDB();
  const instance = await getInstance();
  const connection = await instance.connect();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    connection.interrupt();
  }, timeoutMs);

  const session: DuckDBSession = {
    run: async (sql, params) => {
      try {
        const reader = await connection.runAndReadAll(sql, params);
        return reader.getRowObjects();
      } catch (error) {
        if (timedOut) {
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
    connection.closeSync();
  }
}
