import { z } from "zod";
import { type Connection } from "@temporalio/client";
import {
  ContentRecoveryContextSchema,
  type ContentRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliveryDispatchBarrierEffects } from "#lib/delivery/platform/control-plane-barrier-argo.ts";
import {
  restoreDeliveryDispatch,
  type BarrierEffects,
} from "#lib/delivery/platform/control-plane-barrier.ts";
import { contentOwnership, contentFingerprint } from "./ownership.ts";
import type { ContentNativeReader } from "./native-proof.ts";

export function contentOuterEffects(context: ContentRecoveryContext) {
  return deliveryDispatchBarrierEffects(
    context.deployment.deployment.id,
    undefined,
    () => Promise.resolve(),
    () =>
      Promise.reject(
        new Error("Restoration cannot replace its original barrier journal"),
      ),
  );
}

/** Settlement and restoration are separately durable. Lost restoration response
 * is acknowledged only after exact host/template/new Ready Pod readback.
 */
export async function restoreContentDispatch(
  context: ContentRecoveryContext,
  connection: Connection,
  read: ContentNativeReader,
) {
  const base = `content-recovery/${encodeURIComponent(context.intent.id)}`;
  const journal = context.intent.dispatchBarrier;
  if (
    journal === null ||
    context.intent.status !== "succeeded" ||
    context.intent.barrierRestoredAt !== null
  )
    throw new Error(
      "Content dispatch restoration requires its settled pending barrier",
    );
  const effects = contentOuterEffects(context);
  const HostSchema = z.object({
    metadata: z.object({ uid: z.string() }),
    spec: z.object({ replicas: z.number(), template: z.unknown() }),
    status: z.object({ readyReplicas: z.number().optional() }).optional(),
  });
  const before = HostSchema.parse(await effects.read());
  if (
    before.metadata.uid !== journal.deploymentUID ||
    contentFingerprint(before.spec.template) !== journal.templateFingerprint
  )
    throw new Error("Content producer was replaced before restoration");
  if (before.spec.replicas === 0) {
    const proof = await contentOwnership(context, connection, read, {
      barrier: effects,
    });
    await deliveryRequest(`${base}/admit-restore`, z.unknown(), proof);
    effects.fence = async () => {
      const current = await deliveryRequest(base, ContentRecoveryContextSchema);
      if (
        current.intent.status !== "succeeded" ||
        current.intent.barrierRestoredAt !== null ||
        current.intent.snapshotFingerprint !==
          context.intent.snapshotFingerprint
      )
        throw new Error("Content restoration ownership changed");
      await deliveryRequest(
        `${base}/admit-restore`,
        z.unknown(),
        await contentOwnership(current, connection, read, { barrier: effects }),
      );
    };
    await restoreDeliveryDispatch(effects, journal);
  } else if (before.spec.replicas !== 1)
    throw new Error("Content producer has unexpected replicas");
  for (let attempt = 0; attempt < 120; attempt++) {
    const current = HostSchema.parse(await effects.read());
    if (
      current.metadata.uid !== journal.deploymentUID ||
      contentFingerprint(current.spec.template) !==
        journal.templateFingerprint ||
      current.spec.replicas !== 1
    )
      throw new Error("Restored content producer identity changed");
    const pods = z
      .array(
        z.object({
          metadata: z.object({
            uid: z.string(),
            labels: z.record(z.string(), z.string()),
            ownerReferences: z.array(
              z.object({
                kind: z.string(),
                uid: z.string(),
                controller: z.boolean().optional(),
              }),
            ),
          }),
          status: z.object({
            phase: z.string(),
            conditions: z
              .array(z.object({ type: z.string(), status: z.string() }))
              .default([]),
          }),
        }),
      )
      .parse(await effects.pods())
      .filter(
        (value) => value.metadata.labels["component"] === "delivery-worker",
      );
    if (
      current.status?.readyReplicas === 1 &&
      pods.length === 1 &&
      pods.every(
        (value) =>
          !journal.podUIDs.includes(value.metadata.uid) &&
          value.status.phase === "Running" &&
          value.status.conditions.some(
            (condition) =>
              condition.type === "Ready" && condition.status === "True",
          ),
      )
    ) {
      await requireRestoredOwners(pods, effects, journal.deploymentUID);
      await deliveryRequest(`${base}/restored`, z.unknown(), {
        expectedEnvironmentGeneration:
          context.intent.expectedEnvironmentGeneration + 1,
        snapshotFingerprint: context.intent.snapshotFingerprint,
        observedAt: new Date().toISOString(),
        journalFingerprint: contentFingerprint(journal),
        deploymentUID: journal.deploymentUID,
        templateFingerprint: journal.templateFingerprint,
        replicas: 1,
        readyPodUIDs: pods.map((value) => value.metadata.uid),
      });
      return;
    }
    await effects.wait();
  }
  throw new Error(
    "Content producer restoration has no exact new Ready Pod yet; repeat the same bounded recovery command",
  );
}

async function requireRestoredOwners(
  raw: unknown[],
  effects: BarrierEffects,
  deploymentUID: string,
) {
  const owned = z
    .array(
      z.object({
        metadata: z.object({
          ownerReferences: z.array(
            z.object({
              kind: z.string(),
              uid: z.string(),
              controller: z.boolean().optional(),
            }),
          ),
        }),
      }),
    )
    .parse(raw);
  for (const pod of owned) {
    const owner = pod.metadata.ownerReferences.find(
      (value) => value.kind === "ReplicaSet" && value.controller === true,
    );
    if (owner === undefined)
      throw new Error("Restored content Pod has no ReplicaSet owner");
    z.object({
      metadata: z.object({
        uid: z.literal(owner.uid),
        ownerReferences: z
          .array(
            z.object({
              kind: z.literal("Deployment"),
              uid: z.literal(deploymentUID),
              controller: z.literal(true),
            }),
          )
          .length(1),
      }),
    }).parse(await effects.replicaSet(owner.uid));
  }
}
