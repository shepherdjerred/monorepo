import { Gauge } from "prom-client";
import { register } from "./metrics.ts";

const labels = ["temporal_namespace", "schedule_id", "workflow_type"] as const;

export const temporalScheduleRunning = new Gauge({
  name: "temporal_schedule_running",
  help: "A scheduled action is currently observed running by Workflow Describe",
  labelNames: labels,
  registers: [register],
});

export const temporalScheduleLastTerminalFailed = new Gauge({
  name: "temporal_schedule_last_terminal_failed",
  help: "Latest observed terminal scheduled action failed; a running successor does not clear it",
  labelNames: labels,
  registers: [register],
});
export const temporalScheduleHealthUnknown = new Gauge({
  name: "temporal_schedule_health_unknown",
  help: "Current scheduled-action outcome evidence is incomplete or missing",
  labelNames: labels,
  registers: [register],
});
export const temporalScheduleLastSuccessTimestampSeconds = new Gauge({
  name: "temporal_schedule_last_success_timestamp_seconds",
  help: "Latest completed scheduled action observed in retained execution evidence",
  labelNames: labels,
  registers: [register],
});
export const temporalScheduleObservationTimestampSeconds = new Gauge({
  name: "temporal_schedule_observation_timestamp_seconds",
  help: "Timestamp of the most recent successful Schedule inventory and outcome inspection",
  labelNames: labels,
  registers: [register],
});
