import { updateBettingMetrics } from "#src/metrics/betting/betting-sweep.ts";
import { updateDurablePipelineMetrics } from "#src/metrics/durable-pipeline.ts";
import { updateLimitMetrics } from "#src/metrics/limits.ts";
import { updateScoutTemporalDurabilityMetrics } from "#src/metrics/platform/temporal.ts";
import { updateReportDeliveryMetrics } from "#src/metrics/reports/report-delivery.ts";
import { runRegisteredDatabaseMetricSweeps } from "#src/metrics/sweep-registry.ts";
import { updateUsageMetrics } from "#src/metrics/usage.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("metrics-sweeps");

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
/**
 * How old swept gauges may be before a scrape refreshes them.
 *
 * Prometheus scrapes every 30s, and a full sweep took 0.86s on average in prod
 * and hit the 10s scrape timeout at its worst, which drops every metric the pod
 * serves for that interval. The gauges describe slowly-moving database state, so
 * a minute of staleness costs nothing that alerts on them can see.
 */
export const DATABASE_METRIC_SWEEP_MAX_AGE_MS = 60_000;

type SweepState = {
  lastSuccessAt: number | undefined;
  inFlight: Promise<void> | undefined;
};

const sweepState: SweepState = {
  lastSuccessAt: undefined,
  inFlight: undefined,
};

async function runAndRecord(
  sweep: () => Promise<void>,
  now: () => number,
): Promise<void> {
  try {
    await sweep();
    sweepState.lastSuccessAt = now();
  } finally {
    sweepState.inFlight = undefined;
  }
}

function startSweep(
  sweep: () => Promise<void>,
  now: () => number,
): Promise<void> {
  sweepState.inFlight ??= runAndRecord(sweep, now);
  return sweepState.inFlight;
}

async function refreshInBackground(
  sweep: () => Promise<void>,
  now: () => number,
): Promise<void> {
  try {
    await startSweep(sweep, now);
  } catch (error: unknown) {
    // The next scrape waits for a fresh sweep and surfaces the failure.
    sweepState.lastSuccessAt = undefined;
    logger.error("Background database metric sweep failed", error);
  }
}

/**
 * Keep the swept gauges fresh without making the scrape wait on the database.
 *
 * Until one sweep has succeeded — at boot, or after a failure — the scrape
 * waits for it, so a broken sweep still fails the scrape loudly and no scrape
 * serves gauges that were never written. After that, a stale cache serves the
 * last values immediately and refreshes in the background. Concurrent scrapes
 * share one in-flight sweep.
 */
export async function sweepDatabaseMetricsWhenStale(
  sweep: () => Promise<void> = runDatabaseMetricSweeps,
  now: () => number = Date.now,
): Promise<void> {
  const { lastSuccessAt } = sweepState;
  if (lastSuccessAt === undefined) {
    await startSweep(sweep, now);
    return;
  }
  if (now() - lastSuccessAt < DATABASE_METRIC_SWEEP_MAX_AGE_MS) return;
  void refreshInBackground(sweep, now);
}

export function resetDatabaseMetricSweepStateForTests(): void {
  sweepState.lastSuccessAt = undefined;
  sweepState.inFlight = undefined;
}

export async function runDatabaseMetricSweeps(): Promise<void> {
  await updateUsageMetrics();
  await updateLimitMetrics();
  await updateBettingMetrics();
  await updateScoutTemporalDurabilityMetrics();
  await updateReportDeliveryMetrics();
  await updateDurablePipelineMetrics();
  // Sweeps owned by layers `metrics/` may not import, which therefore register
  // themselves rather than being called by name here.
  await runRegisteredDatabaseMetricSweeps();
}
