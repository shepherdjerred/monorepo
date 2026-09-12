/**
 * Which half of the registry this process composes on a `/metrics` scrape.
 *
 * Prometheus metrics come in two shapes here. Most are recorded as work
 * happens and cost nothing to serve — counters, histograms, gauges written by
 * the code that did the thing. A handful are *collectors*: they answer their
 * question by sweeping the database at scrape time (usage, limits, betting and
 * Temporal durability, all in `getMetrics`). One scrape of those is several
 * full table reads.
 *
 * With one pod that distinction did not matter. Split into roles it does: every
 * role serves `/metrics`, so leaving the sweeps on all of them would multiply
 * one Prometheus scrape interval into N sweeps of the same tables, and the four
 * gauges would be written N times with the same values from N series. They
 * describe the deployment, not the process, so exactly one role owns them —
 * `application`, which already owns the report lake and the database seeding —
 * and every other role serves its process and worker metrics only.
 *
 * The default is on, because everything that reads metrics outside a role boot
 * (scripts, tests, the smoke harness) expects the complete set. A role boot
 * always sets the value from its capability table, so a deployed pod never runs
 * on the default.
 */

let sweepsEnabled = true;

export function setDatabaseMetricSweepsEnabled(enabled: boolean): void {
  sweepsEnabled = enabled;
}

export function databaseMetricSweepsEnabled(): boolean {
  return sweepsEnabled;
}
