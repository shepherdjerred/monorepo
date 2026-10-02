import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metric, type OpsCollection, type OpsContext } from "./ops-types.ts";
import type {
  ScheduleExecutionObservation,
  ScheduleHealthObservation,
} from "./temporal-schedules-client.ts";

const FAILED = new Set(["FAILED", "TIMED_OUT", "CANCELLED", "TERMINATED"]);
const UNKNOWN = new Set([
  "MISSING",
  "UNKNOWN",
  "UNSPECIFIED",
  "CONTINUED_AS_NEW",
]);

export function scheduleOutcome(
  observation: ScheduleHealthObservation,
  now: Date,
) {
  const ordered = observation.actions.toSorted(
    (left, right) =>
      Date.parse(right.scheduledAt) - Date.parse(left.scheduledAt),
  );
  const terminal = ordered.find(
    (action) => action.status === "COMPLETED" || FAILED.has(action.status),
  );
  const success = ordered.find((action) => action.status === "COMPLETED");
  const newerUnknown = ordered.some(
    (action) =>
      UNKNOWN.has(action.status) &&
      (terminal === undefined ||
        Date.parse(action.scheduledAt) > Date.parse(terminal.scheduledAt)),
  );
  const stale =
    now.getTime() - Date.parse(observation.observedAt) >
    OPS_POLICY.scheduleObservationMaxAgeMinutes * 60_000;
  const unknown =
    stale ||
    newerUnknown ||
    observation.running === null ||
    (!observation.paused && terminal === undefined);
  return {
    terminal,
    success,
    failed: terminal !== undefined && FAILED.has(terminal.status),
    unknown,
  };
}

function scheduleLink(observation: ScheduleHealthObservation) {
  return {
    kind: "native" as const,
    label: "Temporal Schedule",
    url: `https://temporal-ui.tailnet-1a49.ts.net/namespaces/${encodeURIComponent(observation.namespace)}/schedules/${encodeURIComponent(observation.scheduleId)}`,
  };
}

function executionAttributes(
  action: ScheduleExecutionObservation | undefined,
): Record<string, string> {
  return action === undefined
    ? {}
    : {
        scheduledAt: action.scheduledAt,
        workflowId: action.workflowId,
        firstExecutionRunId: action.firstExecutionRunId,
        executionStatus: action.status,
      };
}

function scheduleSignals(
  observation: ScheduleHealthObservation,
  now: Date,
): SignalInput[] {
  const signals: SignalInput[] = [];
  const identity = `${observation.namespace}:${observation.scheduleId}`;
  const outcome = scheduleOutcome(observation, now);
  const attributes = {
    scheduleId: observation.scheduleId,
    temporalNamespace: observation.namespace,
    workflowType: observation.workflowType,
    taskQueue: observation.taskQueue,
    paused: observation.paused,
    observedAt: observation.observedAt,
    ...(observation.nextScheduledAt === undefined
      ? {}
      : { nextScheduledAt: observation.nextScheduledAt }),
    ...(outcome.success === undefined
      ? {}
      : {
          lastSuccessAt:
            outcome.success.closedAt ?? outcome.success.scheduledAt,
        }),
  };
  if (observation.paused) {
    signals.push({
      id: `temporal:schedule:${identity}:paused`,
      source: "temporal",
      section: "maintenance",
      kind: "schedule-paused",
      severity: "info",
      needsMe: false,
      title: `${observation.namespace}/${observation.scheduleId} is paused`,
      ...(observation.pauseNote === undefined
        ? {}
        : { detail: observation.pauseNote }),
      attributes,
      links: [scheduleLink(observation)],
    });
  }
  if (outcome.failed) {
    signals.push({
      id: `temporal:schedule:${identity}:failed`,
      source: "temporal",
      section: "maintenance",
      kind: "schedule-failure",
      severity: "warning",
      needsMe: true,
      title: `${observation.namespace}/${observation.scheduleId}: latest terminal action ${outcome.terminal?.status.toLowerCase() ?? "failed"}`,
      detail:
        "This condition remains until a later scheduled action completes successfully. A running successor does not clear it.",
      ...(outcome.terminal === undefined
        ? {}
        : { since: outcome.terminal.closedAt ?? outcome.terminal.scheduledAt }),
      attributes: { ...attributes, ...executionAttributes(outcome.terminal) },
      links: [scheduleLink(observation)],
    });
  }
  if (outcome.unknown) {
    signals.push({
      id: `temporal:schedule:${identity}:unknown`,
      source: "temporal",
      section: "maintenance",
      kind: "schedule-health-unknown",
      severity: "unknown",
      needsMe: false,
      title: `${observation.namespace}/${observation.scheduleId}: current outcome is unknown`,
      detail:
        "Execution evidence is missing, expired, incomplete, or stale; no successful recovery is inferred.",
      attributes,
      links: [scheduleLink(observation)],
    });
  }
  return signals;
}

export function mapTemporalSchedules(
  observations: readonly ScheduleHealthObservation[],
  context: OpsContext,
): OpsCollection {
  const identities = new Set<string>();
  for (const observation of observations) {
    const identity = `${observation.namespace}:${observation.scheduleId}`;
    if (identities.has(identity))
      throw new Error(`Duplicate schedule health ${identity}`);
    identities.add(identity);
  }
  const signals = observations.flatMap((observation) =>
    scheduleSignals(observation, context.now),
  );
  if (observations.length === 0) {
    signals.push({
      id: "temporal:schedules:missing",
      source: "temporal",
      section: "maintenance",
      kind: "schedule-health-unknown",
      severity: "unknown",
      needsMe: false,
      title: "No Temporal Schedule inventory was returned",
    });
  }
  const failures = signals.filter(
    (signal) => signal.kind === "schedule-failure",
  ).length;
  const unknown = signals.filter(
    (signal) => signal.kind === "schedule-health-unknown",
  ).length;
  const paused = signals.filter(
    (signal) => signal.kind === "schedule-paused",
  ).length;
  return {
    signals,
    metrics: [
      metric({
        id: METRIC_IDS.schedulesFailed,
        section: "maintenance",
        source: "temporal",
        label: "Scheduled workflows failing",
        value: failures,
        unit: "count",
        severity: failures > 0 ? "warning" : unknown > 0 ? "unknown" : "ok",
      }),
      metric({
        id: METRIC_IDS.schedulesUnknown,
        section: "maintenance",
        source: "temporal",
        label: "Schedule outcomes unknown",
        value: unknown,
        unit: "count",
        severity: unknown > 0 ? "unknown" : "ok",
      }),
      metric({
        id: METRIC_IDS.schedulesPaused,
        section: "maintenance",
        source: "temporal",
        label: "Paused schedules",
        value: paused,
        unit: "count",
        severity: paused > 0 ? "info" : "ok",
      }),
    ],
    changes: [],
  };
}
