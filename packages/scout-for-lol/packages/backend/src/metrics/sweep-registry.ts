/**
 * Scrape-time database sweeps owned by layers that `metrics/` may not import.
 *
 * `getMetrics()` runs the sweeps that fill collector gauges, and most of them
 * are called from `metrics/sweeps.ts` directly, because `architecture.config.ts`
 * lets `metrics/` reach `database/`. One cannot be: the lake staging lag is
 * keyed by the receipt kinds whose vocabulary `report-lake/` owns, and the same
 * config forbids `metrics/` from importing that layer. That rule is the reason
 * metric definitions stay cross-cutting — a metric module able to reach into a
 * feature to compute its own value couples the registry to that feature's
 * startup order — so the fix is to invert the dependency, not to widen the rule.
 *
 * The owning layer imports the gauge (which any layer may do), computes its own
 * value, and registers the sweep here. `metrics/` learns that a sweep exists
 * without learning anything about what it reads.
 *
 * Registration is keyed by name and last-write-wins, because a module registers
 * from the composition root and nothing stops two entry points reaching it.
 * A role that never registers its sweep simply never publishes that gauge, and
 * it stays absent rather than reporting a fabricated zero — which is the honest
 * answer, and the one the `absent()` guard on its alert is written for.
 */

export type DatabaseMetricSweep = () => Promise<void>;

const sweeps = new Map<string, DatabaseMetricSweep>();

export function registerDatabaseMetricSweep(
  name: string,
  sweep: DatabaseMetricSweep,
): void {
  sweeps.set(name, sweep);
}

/**
 * Run every registered sweep, in registration order.
 *
 * Sequential rather than concurrent, matching the sweeps called by name: they
 * are several full table reads each, and a scrape that fired them all at once
 * would compete with the request traffic the same pool serves.
 *
 * A sweep that throws is its own failure to report — each one already writes a
 * sentinel into its gauges on error — so nothing is caught here. Letting it
 * propagate fails the scrape loudly rather than serving a half-composed
 * registry that reads as healthy.
 */
export async function runRegisteredDatabaseMetricSweeps(): Promise<void> {
  for (const sweep of sweeps.values()) {
    await sweep();
  }
}

/** Test-only reset; the map is a process-wide singleton otherwise. */
export function resetDatabaseMetricSweepsForTest(): void {
  sweeps.clear();
}
