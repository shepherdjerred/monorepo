import { z } from "zod";
import type {
  DriftObservation,
  WatchingMonitor,
} from "@shepherdjerred/delivery/model-contract";

/** `$window` is the time since acceptance, never under two minutes (W4). */
export function monitorWindow(acceptedAt: string, now: Date): string {
  const seconds = Math.max(
    120,
    Math.ceil((now.getTime() - Date.parse(acceptedAt)) / 1000),
  );
  return `${seconds.toString()}s`;
}

/** Firing alerts the monitor watches, scoped by its label matchers (W5). */
export function alarmQuery(monitor: WatchingMonitor["monitor"]): string {
  const matchers = [
    ...Object.entries(monitor.alarms.matchers)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`),
    'alertstate="firing"',
    `severity=~"${monitor.alarms.severities.join("|")}"`,
  ];
  return `ALERTS{${matchers.join(",")}}`;
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
