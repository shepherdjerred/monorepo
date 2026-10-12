/**
 * Reading sandbox pod state from `kubectl get … -o json`. External API output,
 * so the schemas keep only the fields the provider reads.
 */
import { z } from "zod";
import {
  EXPIRES_AT_ANNOTATION,
  KEEP_ANNOTATION,
  MAIN_CONTAINER,
} from "./pod-manifest.ts";

/** Waiting reasons that never resolve on their own. */
const FATAL_WAITING_REASONS = new Set([
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
  "CreateContainerConfigError",
  "CreateContainerError",
  "CrashLoopBackOff",
]);

const ContainerStatusSchema = z.object({
  name: z.string(),
  ready: z.boolean().optional(),
  state: z
    .object({
      running: z.object({}).optional(),
      waiting: z
        .object({
          reason: z.string().optional(),
          message: z.string().optional(),
        })
        .optional(),
      terminated: z
        .object({
          reason: z.string().optional(),
          exitCode: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});
export type ContainerStatus = z.infer<typeof ContainerStatusSchema>;

export const PodSchema = z.object({
  metadata: z.object({
    name: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
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
            message: z.string().optional(),
          }),
        )
        .optional(),
      initContainerStatuses: z.array(ContainerStatusSchema).optional(),
      containerStatuses: z.array(ContainerStatusSchema).optional(),
    })
    .optional(),
});
export type ClusterPod = z.infer<typeof PodSchema>;
export const PodListSchema = z.object({ items: z.array(PodSchema) });

export function statusOf(
  statuses: readonly ContainerStatus[] | undefined,
  name: string,
): ContainerStatus | undefined {
  return statuses?.find((status) => status.name === name);
}

/** Throws when a container can never start (bad image, config, crash loop). */
export function assertStartable(status: ContainerStatus | undefined): void {
  const waiting = status?.state?.waiting;
  if (
    waiting?.reason !== undefined &&
    FATAL_WAITING_REASONS.has(waiting.reason)
  ) {
    throw new Error(
      `Container ${status?.name ?? "?"} cannot start: ${waiting.reason}${waiting.message === undefined ? "" : ` — ${waiting.message}`}`,
    );
  }
}

/** Why a pending pod has not been scheduled, if the scheduler said. */
export function unschedulableReason(pod: ClusterPod): string | undefined {
  const condition = pod.status?.conditions?.find(
    (candidate) =>
      candidate.type === "PodScheduled" && candidate.status === "False",
  );
  return condition?.message ?? condition?.reason;
}

/** Ready when the pod runs and the server container reports ready. */
export function podIsServing(pod: ClusterPod | undefined): boolean {
  return (
    pod?.status?.phase === "Running" &&
    statusOf(pod.status.containerStatuses, MAIN_CONTAINER)?.ready === true
  );
}

/** Expired (TTL passed, not kept) or finished (deadline hit, crashed). */
export function podIsReapable(pod: ClusterPod, now: Date): boolean {
  const phase = pod.status?.phase;
  if (phase === "Failed" || phase === "Succeeded") {
    return true;
  }
  const annotations = pod.metadata.annotations ?? {};
  const expiresAt = annotations[EXPIRES_AT_ANNOTATION];
  return (
    annotations[KEEP_ANNOTATION] !== "true" &&
    expiresAt !== undefined &&
    Date.parse(expiresAt) <= now.getTime()
  );
}
