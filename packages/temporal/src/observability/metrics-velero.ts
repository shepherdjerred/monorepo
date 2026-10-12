import { Gauge } from "prom-client";
import { register } from "./metrics.ts";

const labelNames = ["backup_namespace", "schedule"] as const;

export const veleroScheduleLastTerminalFailed = new Gauge({
  name: "velero_schedule_last_terminal_failed",
  help: "Latest terminal scheduled Backup CR failed or partially failed; a running successor does not clear failure",
  labelNames,
  registers: [register],
});

export const veleroScheduleObservationTimestampSeconds = new Gauge({
  name: "velero_schedule_observation_timestamp_seconds",
  help: "Timestamp of the last complete Velero Schedule and Backup CR inventory read",
  labelNames,
  registers: [register],
});

/** Call only after a complete, validated collection. Failed reads keep old timestamps. */
export function recordVeleroOutcomes(
  observations: readonly {
    namespace: string;
    schedule: string;
    failed: boolean | undefined;
  }[],
  now: Date,
): void {
  veleroScheduleLastTerminalFailed.reset();
  veleroScheduleObservationTimestampSeconds.reset();
  for (const observation of observations) {
    const labels = {
      backup_namespace: observation.namespace,
      schedule: observation.schedule,
    };
    if (observation.failed !== undefined) {
      veleroScheduleLastTerminalFailed.set(labels, observation.failed ? 1 : 0);
    }
    veleroScheduleObservationTimestampSeconds.set(labels, now.getTime() / 1000);
  }
}
