import type { ScoutTemporalQueueClass } from "#src/configuration/runtime-role.ts";

export type ScoutTemporalHealth = {
  readonly state: "starting" | "connected" | "degraded" | "stopping";
  readonly workerCount: number;
  /**
   * Which embedded workers this process polls with.
   *
   * This replaced a `discordWorkersEnabled` boolean, which could only describe
   * the single-pod runtime: on the `activity-worker` role the realtime and
   * background workers run with no Discord gateway at all, so the boolean would
   * have read `false` while both were polling. Naming the queues says what is
   * actually running on the pod being probed.
   */
  readonly queueClasses: readonly ScoutTemporalQueueClass[];
  readonly lastError: string | null;
};

let health: ScoutTemporalHealth = {
  state: "starting",
  workerCount: 0,
  queueClasses: [],
  lastError: null,
};

export function getScoutTemporalHealth(): ScoutTemporalHealth {
  return health;
}

export function setScoutTemporalHealth(next: ScoutTemporalHealth): void {
  health = next;
}
