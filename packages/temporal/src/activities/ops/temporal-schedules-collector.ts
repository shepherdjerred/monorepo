import type { TemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import {
  temporalScheduleHealthUnknown,
  temporalScheduleLastSuccessTimestampSeconds,
  temporalScheduleLastTerminalFailed,
  temporalScheduleObservationTimestampSeconds,
  temporalScheduleRunning,
} from "#observability/metrics-schedules.ts";
import {
  readTemporalScheduleHealth,
  type ScheduleHealthObservation,
} from "./temporal-schedules-client.ts";
import { mapTemporalSchedules, scheduleOutcome } from "./temporal-schedules.ts";
import type { OpsCollection, OpsContext } from "./ops-types.ts";

function recordObservation(
  observation: ScheduleHealthObservation,
  now: Date,
): void {
  const labels = {
    temporal_namespace: observation.namespace,
    schedule_id: observation.scheduleId,
    workflow_type: observation.workflowType,
  };
  const outcome = scheduleOutcome(observation, now);
  temporalScheduleHealthUnknown.set(labels, outcome.unknown ? 1 : 0);
  if (observation.running !== null)
    temporalScheduleRunning.set(labels, observation.running ? 1 : 0);
  temporalScheduleObservationTimestampSeconds.set(
    labels,
    Date.parse(observation.observedAt) / 1000,
  );
  if (outcome.terminal !== undefined)
    temporalScheduleLastTerminalFailed.set(labels, outcome.failed ? 1 : 0);
  if (outcome.success !== undefined)
    temporalScheduleLastSuccessTimestampSeconds.set(
      labels,
      Date.parse(outcome.success.closedAt ?? outcome.success.scheduledAt) /
        1000,
    );
}

export async function collectTemporalSchedules(
  namespace: TemporalNamespace,
  context: OpsContext,
  read: (
    namespace: TemporalNamespace,
    now: Date,
  ) => Promise<ScheduleHealthObservation[]> = readTemporalScheduleHealth,
): Promise<OpsCollection> {
  const observations = await read(namespace, context.now);
  const collection = mapTemporalSchedules(observations, context);
  // Only reset after the complete inventory is read; a failed collection must
  // retain its old observation timestamp so Prometheus detects the blind spot.
  for (const gauge of [
    temporalScheduleHealthUnknown,
    temporalScheduleLastSuccessTimestampSeconds,
    temporalScheduleLastTerminalFailed,
    temporalScheduleObservationTimestampSeconds,
    temporalScheduleRunning,
  ])
    gauge.reset();
  for (const observation of observations)
    recordObservation(observation, context.now);
  return collection;
}
