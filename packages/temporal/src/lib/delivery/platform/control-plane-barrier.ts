import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DispatchBarrierSchema,
  type DispatchBarrier,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";

const identity = z.object({
  name: z.literal("temporal-delivery-worker"),
  namespace: z.literal("temporal"),
  uid: z.string().min(1),
  resourceVersion: z.string().min(1),
});
const host = z.object({
  metadata: identity,
  spec: z.object({ replicas: z.number().int(), template: z.unknown() }),
  status: z
    .object({
      replicas: z.number().optional(),
      readyReplicas: z.number().optional(),
    })
    .optional(),
});
const pod = z.object({
  metadata: z.object({
    uid: z.string().min(1),
    labels: z.record(z.string(), z.string()),
    ownerReferences: z.array(
      z.object({
        kind: z.string(),
        uid: z.string(),
        controller: z.boolean().optional(),
      }),
    ),
  }),
});
const fingerprint = (template: unknown) =>
  createHash("sha256").update(canonicalJson(template)).digest("hex");
export type BarrierEffects = {
  read: () => Promise<unknown>;
  pods: () => Promise<unknown[]>;
  replicaSet: (uid: string) => Promise<unknown>;
  patch: (patch: unknown[]) => Promise<void>;
  checkpoint: (journal: DispatchBarrier) => Promise<void>;
  fence: () => Promise<void>;
  wait: () => Promise<void>;
};

export async function pauseDeliveryDispatch(effects: BarrierEffects) {
  const before = host.parse(await effects.read());
  if (before.spec.replicas !== 1)
    throw new Error(
      "Delivery dispatch barrier requires the exact prior replicas=1 host",
    );
  const currentPods = await effects.pods();
  const owned = currentPods
    .map((raw) => pod.parse(raw))
    .filter(
      (value) => value.metadata.labels["component"] === "delivery-worker",
    );
  for (const value of owned) {
    const owner = value.metadata.ownerReferences.find(
      (reference) =>
        reference.kind === "ReplicaSet" && reference.controller === true,
    );
    if (owner === undefined)
      throw new Error("Delivery dispatch Pod lacks its ReplicaSet owner");
    const replicaSet = z
      .object({
        metadata: z.object({
          uid: z.literal(owner.uid),
          ownerReferences: z
            .array(
              z.object({
                kind: z.literal("Deployment"),
                uid: z.literal(before.metadata.uid),
                controller: z.literal(true),
              }),
            )
            .length(1),
        }),
      })
      .parse(await effects.replicaSet(owner.uid));
    if (replicaSet.metadata.uid !== owner.uid)
      throw new Error("Delivery dispatch ReplicaSet identity changed");
  }
  const journal = DispatchBarrierSchema.parse({
    adapter: "control-plane-dispatch-barrier/v1",
    deploymentUID: before.metadata.uid,
    templateFingerprint: fingerprint(before.spec.template),
    priorReplicas: 1,
    podUIDs: owned.map((value) => value.metadata.uid),
    replicaSetUIDs: [
      ...new Set(
        owned.flatMap((value) =>
          value.metadata.ownerReferences
            .filter((reference) => reference.kind === "ReplicaSet")
            .map((reference) => reference.uid),
        ),
      ),
    ],
  });
  await effects.checkpoint(journal);
  return await pauseRecordedDeliveryDispatch(effects, journal);
}

/** Resume only the exact checkpointed host after a lost replica-patch response. */
export async function pauseRecordedDeliveryDispatch(
  effects: BarrierEffects,
  journal: DispatchBarrier,
) {
  await effects.fence();
  const initial = requireSameHost(await effects.read(), journal);
  if (initial.spec.replicas === 1) await setReplicas(effects, journal, 1, 0);
  else if (initial.spec.replicas !== 0)
    throw new Error("Journaled dispatch host has unexpected replicas");
  for (let attempt = 0; attempt < 120; attempt++) {
    await effects.fence();
    const current = requireSameHost(await effects.read(), journal);
    const observedPods = await effects.pods();
    const pods = observedPods.map((raw) => pod.parse(raw));
    if (
      current.spec.replicas === 0 &&
      (current.status?.replicas ?? 0) === 0 &&
      !pods.some((value) => dispatchPod(value, journal))
    )
      return journal;
    await effects.wait();
  }
  throw new Error(
    "Delivery dispatch processes did not terminate; retain the journal and recover the exact prior host",
  );
}
function dispatchPod(value: z.infer<typeof pod>, journal: DispatchBarrier) {
  return (
    journal.podUIDs.includes(value.metadata.uid) ||
    value.metadata.labels["component"] === "delivery-worker" ||
    value.metadata.ownerReferences.some((reference) =>
      journal.replicaSetUIDs.includes(reference.uid),
    )
  );
}
export async function assertDeliveryDispatchPaused(
  effects: BarrierEffects,
  journal: DispatchBarrier,
) {
  const current = requireSameHost(await effects.read(), journal);
  const pods = await effects.pods();
  if (
    current.spec.replicas !== 0 ||
    (current.status?.replicas ?? 0) !== 0 ||
    pods.some((raw) => dispatchPod(pod.parse(raw), journal))
  )
    throw new Error(
      "Delivery dispatch host resumed or an old process remains before source selection",
    );
}

function requireSameHost(raw: unknown, journal: DispatchBarrier) {
  const current = host.parse(raw);
  if (
    current.metadata.uid !== journal.deploymentUID ||
    fingerprint(current.spec.template) !== journal.templateFingerprint
  )
    throw new Error(
      "Delivery dispatch host UID or template changed; refusing a blind replica write",
    );
  return current;
}
async function setReplicas(
  effects: BarrierEffects,
  journal: DispatchBarrier,
  from: number,
  to: number,
) {
  const current = requireSameHost(await effects.read(), journal);
  if (current.spec.replicas !== from)
    throw new Error(
      "Delivery dispatch replicas changed outside the owned barrier",
    );
  await effects.patch([
    { op: "test", path: "/metadata/uid", value: current.metadata.uid },
    {
      op: "test",
      path: "/metadata/resourceVersion",
      value: current.metadata.resourceVersion,
    },
    { op: "test", path: "/spec/replicas", value: from },
    { op: "replace", path: "/spec/replicas", value: to },
  ]);
}
export async function restoreDeliveryDispatch(
  effects: BarrierEffects,
  journal: DispatchBarrier,
) {
  await effects.fence();
  const current = requireSameHost(await effects.read(), journal);
  if (current.spec.replicas === 1) return;
  await setReplicas(effects, journal, 0, 1);
}
