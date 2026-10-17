import { z } from "zod";
import {
  LegacyObservationError,
  observerDigest,
  type Resource,
} from "./wire.ts";

const template = z.object({
  template: z.object({ spec: z.record(z.string(), z.unknown()) }),
});
export function canonicalWorkerPod(
  deployment: Resource,
  inventory: Resource[],
) {
  const sets = inventory.filter(
    (item) =>
      item.kind === "ReplicaSet" &&
      item.metadata.ownerReferences.some(
        (owner) =>
          owner.kind === "Deployment" &&
          owner.uid === deployment.metadata.uid &&
          owner.name === deployment.metadata.name,
      ),
  );
  const setIds = new Set(sets.map((item) => item.metadata.uid));
  const pods = inventory.filter(
    (item) =>
      item.kind === "Pod" &&
      (item.metadata.name.startsWith(`${deployment.metadata.name}-`) ||
        item.metadata.ownerReferences.some((owner) => setIds.has(owner.uid))),
  );
  const pod = pods[0];
  if (pod === undefined || pods.length !== 1)
    throw new LegacyObservationError("canonical_worker_not_unique");
  if (
    pod.metadata.deletionTimestamp !== undefined ||
    pod.status["phase"] !== "Running"
  )
    throw new LegacyObservationError("canonical_worker_not_running");
  const conditions = z
    .array(z.object({ type: z.string(), status: z.string() }))
    .parse(pod.status["conditions"]);
  if (
    !conditions.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    )
  )
    throw new LegacyObservationError("canonical_worker_not_ready");
  const owner = pod.metadata.ownerReferences[0];
  const set = sets.find((item) => item.metadata.uid === owner?.uid);
  if (
    set === undefined ||
    pod.metadata.ownerReferences.length !== 1 ||
    owner?.kind !== "ReplicaSet" ||
    owner.name !== set.metadata.name ||
    set.metadata.deletionTimestamp !== undefined
  )
    throw new LegacyObservationError("canonical_worker_lineage_changed");
  const current = template.parse(deployment.spec).template.spec;
  if (
    observerDigest(template.parse(set.spec).template.spec) !==
    observerDigest(current)
  )
    throw new LegacyObservationError("canonical_worker_old_template");
  const status = z
    .object({
      observedGeneration: z.int().nonnegative(),
      replicas: z.literal(1),
      readyReplicas: z.literal(1),
      updatedReplicas: z.literal(1),
    })
    .safeParse(deployment.status);
  if (
    deployment.spec["replicas"] !== 1 ||
    !status.success ||
    status.data.observedGeneration !== deployment.metadata.generation
  )
    throw new LegacyObservationError("canonical_worker_rollout_incomplete");
  return { pod, replicaSetUid: set.metadata.uid };
}
