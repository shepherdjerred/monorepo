import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Instrumentation for durable record writes (`durable/match/durable-facts.ts`).
 * The metric names keep the `dualwrite` word they were introduced under, so
 * existing dashboards and alerts keep reading them.
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
  help: "Durable record writes that failed without failing the effect they describe, by write kind.",
  labelNames: ["write_kind"] as const,
  registers: [registry],
});

export const scoutDurableDualwriteRecordsTotal = new Counter({
  name: "scout_durable_dualwrite_records_total",
  help: "Durable facts recorded, by write kind and repository outcome.",
  labelNames: ["write_kind", "outcome"] as const,
  registers: [registry],
});
