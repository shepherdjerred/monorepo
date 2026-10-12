/** Shared cold report-lake startup budget for Scout probes and release waits. */
export const SCOUT_STARTUP_PROBE_PERIOD_SECONDS = 10;
export const SCOUT_STARTUP_PROBE_FAILURE_THRESHOLD = 240;

/** Allow the complete startup budget plus readiness and Argo sync-wave latency. */
export const SCOUT_CHILD_SYNC_TIMEOUT_SECONDS =
  SCOUT_STARTUP_PROBE_PERIOD_SECONDS * SCOUT_STARTUP_PROBE_FAILURE_THRESHOLD +
  300;

export const SCOUT_CHILD_SYNC_TIMEOUT_FLOORS: ReadonlyMap<string, number> =
  new Map([
    ["scout-beta", SCOUT_CHILD_SYNC_TIMEOUT_SECONDS],
    ["scout-prod", SCOUT_CHILD_SYNC_TIMEOUT_SECONDS],
  ]);
