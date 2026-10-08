import { z } from "zod";
import { captureJson } from "./process.ts";

const Timestamp = z.iso.datetime({ offset: true });
const StateSchema = z.object({
  waiting: z.object({ reason: z.string().optional() }).optional(),
  running: z.object({ startedAt: Timestamp }).optional(),
  terminated: z
    .object({
      startedAt: Timestamp,
      finishedAt: Timestamp,
      reason: z.string().optional(),
    })
    .optional(),
});
export const CiPodListSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({
        name: z.string(),
        uid: z.string(),
        creationTimestamp: Timestamp,
        labels: z.record(z.string(), z.string()).default({}),
      }),
      spec: z.object({
        schedulingGates: z.array(z.object({ name: z.string() })).optional(),
      }),
      status: z
        .object({
          phase: z.string().optional(),
          conditions: z
            .array(
              z.object({
                type: z.string(),
                status: z.string(),
                reason: z.string().optional(),
                lastTransitionTime: Timestamp.optional(),
              }),
            )
            .optional(),
          containerStatuses: z
            .array(
              z.object({
                name: z.string(),
                restartCount: z.number(),
                state: StateSchema,
              }),
            )
            .optional(),
        })
        .optional(),
    }),
  ),
});

type CiPod = z.infer<typeof CiPodListSchema>["items"][number];

function containerStatus(pod: CiPod) {
  return pod.status?.containerStatuses?.find(
    (status) => status.name === pod.metadata.name,
  );
}

function waitingReason(pod: CiPod): string | null {
  if ((pod.spec.schedulingGates?.length ?? 0) > 0) return "admission";
  const scheduled = pod.status?.conditions?.find(
    (condition) => condition.type === "PodScheduled",
  );
  return scheduled?.status === "False"
    ? (scheduled.reason ?? "scheduling")
    : (containerStatus(pod)?.state.waiting?.reason ?? null);
}

export function summarizeCiPods(
  list: z.infer<typeof CiPodListSchema>,
  now = Date.now(),
) {
  return list.items
    .filter(
      (pod) => pod.metadata.labels["woodpecker-ci.org/task-uuid"] !== undefined,
    )
    .map((pod) => {
      const container = containerStatus(pod);
      const started =
        container?.state.running?.startedAt ??
        container?.state.terminated?.startedAt;
      const created = Date.parse(pod.metadata.creationTimestamp);
      return {
        pod: pod.metadata.name,
        podUid: pod.metadata.uid,
        taskId: pod.metadata.labels["woodpecker-ci.org/task-uuid"],
        step: pod.metadata.labels["ci.sjer.red/step-key"] ?? null,
        commit: pod.metadata.labels["ci.sjer.red/commit"] ?? null,
        phase: pod.status?.phase ?? "Pending",
        waitingReason: waitingReason(pod),
        ageSeconds: (now - created) / 1000,
        startupSeconds:
          started === undefined ? null : (Date.parse(started) - created) / 1000,
        restarts: container?.restartCount ?? 0,
      };
    });
}

export async function ciPods(signal?: AbortSignal) {
  return summarizeCiPods(
    await captureJson(
      ["kubectl", "get", "pods", "--namespace", "woodpecker-ci", "-o", "json"],
      CiPodListSchema,
      signal,
    ),
  );
}
