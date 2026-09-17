import { updateBettingMetrics } from "#src/metrics/betting/betting-sweep.ts";
import { updateDurablePipelineMetrics } from "#src/metrics/durable-pipeline.ts";
import { updateLimitMetrics } from "#src/metrics/limits.ts";
import { updateScoutTemporalDurabilityMetrics } from "#src/metrics/platform/temporal.ts";
import { runRegisteredDatabaseMetricSweeps } from "#src/metrics/sweep-registry.ts";
import { updateUsageMetrics } from "#src/metrics/usage.ts";

/**
 * Every collector that answers its question by reading the database.
 *
 * `getMetrics()` calls this behind `databaseMetricSweepsEnabled()`, so the
 * whole set is composed by exactly one runtime role — see `sweep-policy.ts` for
 * why these describe the deployment rather than the process, and what it would
 * cost to run them on all of them.
 *
 * They live here rather than inline in `metrics/index.ts` because that file is
 * a registry of metric definitions and is at its line cap; the list of things a
 * scrape sweeps is a different concern that was only ever there because it had
 * nowhere else to be. `getMetrics()` still owns the decision to run them, which
 * keeps the capability check in one place.
 *
 * This module is only ever reached through that deferred import, which is what
 * keeps `usage.ts`'s import of `metrics/index.ts` from closing an eager cycle.
 *
 * Sequential on purpose. Each of these is several full table reads, and a
 * scrape that fired them concurrently would compete with the request traffic
 * the same connection pool serves.
 */
export async function runDatabaseMetricSweeps(): Promise<void> {
  await updateUsageMetrics();
  await updateLimitMetrics();
  await updateBettingMetrics();
  await updateScoutTemporalDurabilityMetrics();
  await updateDurablePipelineMetrics();
  // Sweeps owned by layers `metrics/` may not import, which therefore register
  // themselves rather than being called by name here.
  await runRegisteredDatabaseMetricSweeps();
}
