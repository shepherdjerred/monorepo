import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Parity instrumentation for the durable dual-write bridge.
 *
 * THIS IS THE SINGLE DEFINITION SITE for these metrics. prom-client throws at
 * import time when two modules register the same metric name on the shared
 * registry, which takes the process down on boot rather than at the first
 * `inc()`. Every producer — the match services here, the receipted lake
 * projection — imports these symbols; nobody declares a second counter with
 * the same name.
 *
 * Both are per-write counters incremented inline by whichever runtime role
 * executed the write, so a parity dashboard joins across roles rather than
 * reading one process. Neither is derived from a database sweep, so neither
 * belongs in `getMetrics()`'s `databaseMetricSweepsEnabled()` block.
 */

export const scoutDurableDualwriteFailuresTotal = new Counter({
  name: "scout_durable_dualwrite_failures_total",
  help: "Durable dual-write side-effects that failed without failing the v1 path, by write kind.",
  labelNames: ["write_kind"] as const,
  registers: [registry],
});

export const scoutDurableDualwriteRecordsTotal = new Counter({
  name: "scout_durable_dualwrite_records_total",
  help: "Durable facts recorded alongside the v1 pipeline, by write kind and repository outcome.",
  labelNames: ["write_kind", "outcome"] as const,
  registers: [registry],
});
