import { z } from "zod";
import { snapshotHash } from "#migration/profile-import.ts";

export const observerDigest = (value: unknown) =>
  snapshotHash(z.json().parse(value));

export class LegacyObservationError extends Error {
  constructor(readonly code: string) {
    super(`Legacy observer: ${code}`);
    this.name = "LegacyObservationError";
  }
}
const owner = z.object({ uid: z.string(), name: z.string(), kind: z.string() });
export const ResourceSchema = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.literal("media"),
    uid: z.string().min(1),
    resourceVersion: z.string().min(1),
    generation: z.int().positive().optional(),
    deletionTimestamp: z.string().optional(),
    ownerReferences: z.array(owner).default([]),
    labels: z.record(z.string(), z.string()).default({}),
  }),
  spec: z.record(z.string(), z.unknown()),
  status: z.record(z.string(), z.unknown()).default({}),
});
export type Resource = z.infer<typeof ResourceSchema>;
export const ListSchema = z.object({
  kind: z.string(),
  metadata: z.object({
    continue: z.string().optional(),
    resourceVersion: z.string().min(1),
  }),
  items: z.array(ResourceSchema.extend({ kind: z.string().optional() })),
});
export type ObserverRequest = (
  path: string,
  signal: AbortSignal,
) => Promise<unknown>;
export const RESOURCE_PATHS = [
  ["Deployment", "/apis/apps/v1/namespaces/media/deployments"],
  ["ReplicaSet", "/apis/apps/v1/namespaces/media/replicasets"],
  ["StatefulSet", "/apis/apps/v1/namespaces/media/statefulsets"],
  ["DaemonSet", "/apis/apps/v1/namespaces/media/daemonsets"],
  ["Job", "/apis/batch/v1/namespaces/media/jobs"],
  ["CronJob", "/apis/batch/v1/namespaces/media/cronjobs"],
  [
    "HorizontalPodAutoscaler",
    "/apis/autoscaling/v2/namespaces/media/horizontalpodautoscalers",
  ],
  ["Pod", "/api/v1/namespaces/media/pods"],
];
