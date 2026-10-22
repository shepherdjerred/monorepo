import { z } from "zod";
import {
  AlarmSeveritySchema,
  FiringAlarmSchema,
  type DriftObservation,
  type FiringAlarm,
  type WatchingMonitor,
} from "@shepherdjerred/delivery/model-contract";

/**
 * Prometheus as the Delivery worker reaches it: the in-cluster Service
 * (9090, the Caddy gateway sidecar's pod port 9091), as the worker-host
 * poller check reads it.
 */
export const PROMETHEUS_SERVICE_URL =
  "http://prometheus-kube-prometheus-prometheus.prometheus:9090";

/** `$window` is the time since acceptance, never under two minutes (W4). */
export function monitorWindow(acceptedAt: string, now: Date): string {
  const seconds = Math.max(
    120,
    Math.ceil((now.getTime() - Date.parse(acceptedAt)) / 1000),
  );
  return `${seconds.toString()}s`;
}

function labelMatcher(name: string, value: string): string {
  return value.startsWith("~")
    ? `${name}=~${JSON.stringify(value.slice(1))}`
    : `${name}=${JSON.stringify(value)}`;
}

/**
 * Firing alerts the monitor watches, scoped by its label matchers (W5),
 * each with when it became active: `ALERTS_FOR_STATE`'s sample value is the
 * active-since time, joined to the firing `ALERTS` series.
 */
export function alarmQuery(monitor: WatchingMonitor["monitor"]): string {
  const matchers = [
    ...Object.entries(monitor.alarms.matchers)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => labelMatcher(name, value)),
    `severity=~"${monitor.alarms.severities.join("|")}"`,
  ];
  return `ALERTS_FOR_STATE{${matchers.join(",")}} and ignoring(alertstate) ALERTS{${[...matchers, 'alertstate="firing"'].join(",")}}`;
}

/** The alarms an `alarmQuery` result names, with their activation times. */
export function firingAlarms(
  samples: readonly { metric: Record<string, string>; value: number }[],
): FiringAlarm[] {
  return samples.map((sample) => {
    const { __name__: _series, ...labels } = sample.metric;
    return FiringAlarmSchema.parse({
      alertname: z.string().min(1).parse(labels["alertname"]),
      severity: AlarmSeveritySchema.parse(labels["severity"]),
      labels,
      activeAt: new Date(sample.value * 1000).toISOString(),
    });
  });
}

const ResourceSchema = z.object({
  kind: z.string(),
  name: z.string(),
  namespace: z.string().optional(),
  group: z.string().optional(),
});
const SelfHealSchema = z.object({
  status: z
    .object({
      operationState: z
        .object({
          phase: z.string(),
          startedAt: z.iso.datetime({ offset: true }),
          operation: z.object({
            initiatedBy: z
              .object({ automated: z.boolean().optional() })
              .optional(),
          }),
          syncResult: z
            .object({
              revision: z.string().optional(),
              resources: z.array(ResourceSchema).default([]),
            })
            .optional(),
        })
        .optional(),
    })
    .default({}),
});

/**
 * The self-heal ArgoCD ran on an accepted Application after acceptance, or
 * null when its last operation was Delivery's own (T4).
 */
export function selfHealDrift(
  raw: unknown,
  input: { application: string; acceptedAt: string; observedAt: Date },
): DriftObservation | null {
  const state = SelfHealSchema.parse(raw).status.operationState;
  if (
    state?.operation.initiatedBy?.automated !== true ||
    Date.parse(state.startedAt) <= Date.parse(input.acceptedAt)
  )
    return null;
  return {
    observedAt: input.observedAt.toISOString(),
    application: input.application,
    startedAt: state.startedAt,
    phase: state.phase,
    revision: state.syncResult?.revision ?? null,
    resources: (state.syncResult?.resources ?? [])
      .slice(0, 200)
      .map(
        (resource) =>
          `${resource.group ?? ""}/${resource.kind}/${resource.namespace ?? ""}/${resource.name}`,
      ),
  };
}
