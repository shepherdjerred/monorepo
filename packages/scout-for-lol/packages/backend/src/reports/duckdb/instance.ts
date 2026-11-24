import path from "node:path";
import type * as DuckDBModuleNamespace from "@duckdb/node-api";
import type { DuckDBInstance, DuckDBValue } from "@duckdb/node-api";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import { PARQUET_WRITE_SETTINGS } from "./writes/parquet.ts";

const logger = createLogger("duckdb");

/**
 * Embedded DuckDB lifecycle for the report lake.
 *
 * - The NAPI module is loaded lazily via dynamic import (same pattern as
 *   @resvg/resvg-js in the report package) so bot startup and hot paths
 *   never pay for it.
 * - One process-wide in-memory instance per pool (report queries, lake
 *   maintenance) amortizes startup; every query gets
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

/**
 * The two DuckDB instances a process may hold.
 *
 * `report` answers user-facing queries (Explore, reports, Dares, web pages)
 * under the configured thread and memory budget, two at a time.
 * `maintenance` is the lake's own writer: fold and rebuild COPYs and crawl-day
 * compaction. Before it existed, a fold or a nightly rebuild held one of the
 * two report slots for its whole run, so one lake job halved interactive
 * query capacity. Maintenance runs one connection at a time (the compactor
 * already serializes lake jobs) with a smaller fixed budget, and spills to its
 * own subdirectory so the two instances never share temporary files.
 */
type DuckDBPool = {
  name: "report" | "maintenance";
  semaphore: AsyncSemaphore;
  instance: Promise<DuckDBInstance> | undefined;
};

const MAX_CONCURRENT_MAINTENANCE_CONNECTIONS = 1;
const MAINTENANCE_THREADS = "2";
const MAINTENANCE_MEMORY_LIMIT = "2GB";

const DEFAULT_SPILL_BUDGET = "7GiB";
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/**
 * The most the maintenance instance may spill.
 *
 * Every maintenance statement is a streaming COPY. Folds and rebuilds feed
 * NDJSON to Parquet in batches of at most 32 MiB, with partition writers
 * flushed every 2,048 rows and at most four open (writes/parquet.ts).
 * `compactCrawlDay` and `rebuildCrawlDay` read one ingest day, tens to low
 * hundreds of MB of Parquet at the top crawl budget, and write one file with
 * no ORDER BY, aggregate or wide join; the only join is the erased-match
 * filter over a short id list. None of them holds sort or hash state past
 * the 2 GB memory limit, so spill is a margin, not a working set. Before the
 * split these ran under the report instance's cap; carving 1 GiB out of that
 * same budget keeps the process total where it was.
 */
const MAINTENANCE_SPILL_CAP_BYTES = GIB;

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
  tb: 1000 ** 4,
  kib: 1024,
  mib: MIB,
  gib: GIB,
  tib: 1024 ** 4,
};

/** Bytes in a DuckDB size string such as `7GiB` or `3GB`. */
function sizeBytes(value: string): number {
  const match = /^(\d+(?:\.\d+)?) ?([a-z]*)$/iu.exec(value.trim());
  const suffix = match?.[2] ?? "";
  const unit = SIZE_UNITS[suffix === "" ? "b" : suffix.toLowerCase()];
  if (unit === undefined || match?.[1] === undefined) {
    throw new Error(`Not a DuckDB size: ${value}`);
  }
  return Math.floor(Number(match[1]) * unit);
}

export type DuckDbSpillBudgets = {
  reportBytes: number;
  maintenanceBytes: number;
  /** The settings DuckDB receives, in whole MiB. */
  report: string;
  maintenance: string;
};

/**
 * Split the process's one spill budget between the two instances.
 *
 * `REPORT_DUCKDB_MAX_TEMP_SIZE` is the cap the deployment derives from the
 * scratch volume it mounts (homelab `SCOUT_DUCKDB_SCRATCH`: the volume size
 * less headroom), so it is the single declared size. Both instances spill to
 * that volume, so their caps are carved from it rather than set beside it:
 * maintenance takes at most 1 GiB (and never more than a quarter), report
 * queries keep the rest, and the two always sum to no more than the budget.
 */
export function duckDbSpillBudgets(totalSpill: string): DuckDbSpillBudgets {
  const total = sizeBytes(totalSpill);
  const maintenanceBytes =
    Math.floor(Math.min(MAINTENANCE_SPILL_CAP_BYTES, total / 4) / MIB) * MIB;
  const reportBytes = Math.floor((total - maintenanceBytes) / MIB) * MIB;
  return {
    reportBytes,
    maintenanceBytes,
    report: `${(reportBytes / MIB).toString()}MiB`,
    maintenance: `${(maintenanceBytes / MIB).toString()}MiB`,
  };
}

const reportPool: DuckDBPool = {
  name: "report",
  semaphore: new AsyncSemaphore(MAX_CONCURRENT_REPORT_QUERIES),
  instance: undefined,
};

const maintenancePool: DuckDBPool = {
  name: "maintenance",
  semaphore: new AsyncSemaphore(MAX_CONCURRENT_MAINTENANCE_CONNECTIONS),
  instance: undefined,
};

function spillSettings(pool: DuckDBPool): Record<string, string> {
  // Widened to unknown to survive partial test mocks of the configuration
  // module (a former process-wide Bun mock leaked here; see auth-web.test.ts);
  // real runs always have the env-var defaults.
  const configuredTempDir: unknown = configuration.reportDuckDbTempDir;
  const configuredMaxTemp: unknown = configuration.reportDuckDbMaxTempSize;
  if (typeof configuredTempDir !== "string") return {};
  const budgets = duckDbSpillBudgets(
    typeof configuredMaxTemp === "string"
      ? configuredMaxTemp
      : DEFAULT_SPILL_BUDGET,
  );
  // A query larger than memory_limit spills here instead of failing.
  if (pool.name === "maintenance") {
    return {
      temp_directory: path.join(configuredTempDir, "maintenance"),
      max_temp_directory_size: budgets.maintenance,
    };
  }
  return {
    temp_directory: configuredTempDir,
    max_temp_directory_size: budgets.report,
  };
}

function instanceSettings(pool: DuckDBPool): Record<string, string> {
  const configuredThreads: unknown = configuration.reportDuckDbThreads;
  const configuredMemory: unknown = configuration.reportDuckDbMemoryLimit;
  const report = pool.name === "report";
  return {
    threads: report
      ? (typeof configuredThreads === "number"
          ? configuredThreads
          : 4
        ).toString()
      : MAINTENANCE_THREADS,
    memory_limit: report
      ? typeof configuredMemory === "string"
        ? configuredMemory
        : "3GB"
      : MAINTENANCE_MEMORY_LIMIT,
    preserve_insertion_order: "false",
    ...PARQUET_WRITE_SETTINGS,
    ...spillSettings(pool),
  };
}

async function getInstance(pool: DuckDBPool): Promise<DuckDBInstance> {
  pool.instance ??= (async () => {
    const duckdb = await loadDuckDB();
    const settings = instanceSettings(pool);
    logger.info(
      `Creating ${pool.name} DuckDB instance (threads=${settings["threads"] ?? "default"}, memory_limit=${settings["memory_limit"] ?? "default"}, temp_directory=${settings["temp_directory"] ?? "none"})`,
    );
    return await duckdb.DuckDBInstance.create(":memory:", settings);
  })();
  return await pool.instance;
}

type ConnectionOptions = { timeoutMs?: number; abortSignal?: AbortSignal };

/**
 * Run `fn` with a fresh report connection. Every statement issued through the
 * session shares one timeout budget; when it expires the connection is
 * interrupted and a ReportQueryTimeoutError is thrown.
 */
export async function withDuckDBConnection<T>(
  fn: (session: DuckDBSession) => Promise<T>,
  options: ConnectionOptions = {},
): Promise<T> {
  return await withPooledConnection(reportPool, fn, options);
}

/**
 * Run `fn` with a connection to the lake-maintenance instance: folds,
 * rebuilds and crawl-day compaction. It never waits on, or holds, a report
 * query slot.
 */
export async function withMaintenanceDuckDBConnection<T>(
  fn: (session: DuckDBSession) => Promise<T>,
  options: ConnectionOptions = {},
): Promise<T> {
  return await withPooledConnection(maintenancePool, fn, options);
}

async function withPooledConnection<T>(
  pool: DuckDBPool,
  fn: (session: DuckDBSession) => Promise<T>,
  options: ConnectionOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const acquireController = new AbortController();
  const acquisition = { timedOut: false };
  const timer = setTimeout(() => {
    acquisition.timedOut = true;
    acquireController.abort();
  }, timeoutMs);
  const abortWaiting = () => {
    acquireController.abort();
  };
  options.abortSignal?.addEventListener("abort", abortWaiting, { once: true });
  if (options.abortSignal?.aborted === true) {
    abortWaiting();
  }

  let release: (() => void) | undefined;
  try {
    try {
      release = await pool.semaphore.acquire(acquireController.signal);
    } catch (error: unknown) {
      if (acquisition.timedOut) {
        throw new ReportQueryTimeoutError(timeoutMs);
      }
      throw error;
    }
  } finally {
    clearTimeout(timer);
    options.abortSignal?.removeEventListener("abort", abortWaiting);
  }

  try {
    return await withDuckDBConnectionSlot(pool, fn, {
      ...options,
      timeoutMs: Math.max(0, deadline - Date.now()),
    });
  } finally {
    release();
  }
}

async function withDuckDBConnectionSlot<T>(
  pool: DuckDBPool,
  fn: (session: DuckDBSession) => Promise<T>,
  options: ConnectionOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const duckdb = await loadDuckDB();
  const instance = await getInstance(pool);
  const connection = await instance.connect();

  const timeoutState = { timedOut: false, aborted: false };
  const hasTimedOut = () => timeoutState.timedOut;
  const hasAborted = () => timeoutState.aborted;
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
      if (hasAborted()) {
        throw new DOMException("DuckDB query aborted.", "AbortError");
      }
      if (hasTimedOut()) {
        throw new ReportQueryTimeoutError(timeoutMs);
      }
      try {
        const reader = await connection.runAndReadAll(sql, params);
        return reader.getRowObjects();
      } catch (error) {
        if (hasAborted()) {
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
 * Release the process-wide instances.
 *
 * The server never calls this: the instances are meant to live as long as the
 * process, and connections are already closed per query. A CLI is the other
 * case — left open, a native instance is only released by finalization,
 * which measurably delays exit after the work is done. Idempotent, and a
 * later query simply creates a new instance.
 */
export async function closeDuckDB(): Promise<void> {
  for (const pool of [reportPool, maintenancePool]) {
    const pending = pool.instance;
    if (pending === undefined) continue;
    pool.instance = undefined;
    const instance = await pending;
    instance.closeSync();
  }
}
