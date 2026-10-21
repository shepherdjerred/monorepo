import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
} from "#infrastructure/delivery-records.ts";
import {
  ContentBarrierRestorationSchema,
  ContentRecoveryOwnershipSchema,
  type ContentBarrierRestoration,
  type ContentRecoveryOwnership,
  type Principal,
} from "#shared/contract.ts";
import { findIntent } from "#infrastructure/recovery-intents.ts";
import { requireFreshContentObservation } from "./ownership.ts";
import { contentIntentView } from "./context.ts";
import { inspectContentProof } from "./proof.ts";

async function restoreOwnership(
  tx: Transaction,
  id: string,
  generation: number,
) {
  await lock(tx, "delivery:claim");
  await lock(tx, `content-recovery:${id}`);
  const raw = await findIntent(tx, id, "content");
  const intent = contentIntentView(raw);
  const row = required(
    await tx.deployment.findUnique({ where: { id: intent.deploymentId } }),
    "Content recovery source",
  );
  await lock(tx, `environment:${row.environmentId}`);
  const env = required(
    await tx.environment.findUnique({ where: { id: row.environmentId } }),
    "Content environment",
  );
  const global = await tx.platformLock.findUnique({
    where: { id: "platform" },
  });
  // Settlement released ownership without moving the generation (E1), so
  // the restoring observation names the generation the intent froze.
  if (
    intent.status !== "succeeded" ||
    intent.dispatchBarrier === null ||
    row.recoveryRequired ||
    !["failed", "canceled"].includes(row.status) ||
    env.activeDeploymentId !== null ||
    env.generation !== intent.expectedEnvironmentGeneration ||
    env.generation !== generation ||
    (intent.barrierRestoredAt === null && global?.deploymentId !== row.id)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Only independently settled content may restore its exact globally held producer barrier",
    );
  return { intent, row, env };
}

export async function admitContentRecoveryRestore(
  this: Delivery,
  id: string,
  raw: ContentRecoveryOwnership,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = ContentRecoveryOwnershipSchema.parse(raw);
  const before = await inspectContentProof(this, id, input, {
    restoring: true,
  });
  return this.database.$transaction(async (tx) => {
    const { intent } = await restoreOwnership(
      tx,
      id,
      input.expectedEnvironmentGeneration,
    );
    requireFreshContentObservation(input.observedAt);
    if (
      intent.barrierRestoredAt !== null ||
      fingerprint(intent) !== fingerprint(before.intent)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Content barrier changed or was already restored after independent inspection",
      );
    await audit(tx, actor, {
      action: "content.recovery_restore_admitted",
      entityId: id,
      requestId: id,
      metadata: input,
    });
    return intent;
  });
}

export async function restoredContentRecovery(
  this: Delivery,
  id: string,
  raw: ContentBarrierRestoration,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = ContentBarrierRestorationSchema.parse(raw);
  requireFreshContentObservation(input.observedAt);
  return this.database.$transaction(async (tx) => {
    const { intent, row } = await restoreOwnership(
      tx,
      id,
      input.expectedEnvironmentGeneration,
    );
    requireFreshContentObservation(input.observedAt);
    const barrier = intent.dispatchBarrier;
    if (
      barrier === null ||
      input.snapshotFingerprint !== intent.snapshotFingerprint ||
      input.journalFingerprint !== fingerprint(barrier) ||
      input.deploymentUID !== barrier.deploymentUID ||
      input.templateFingerprint !== barrier.templateFingerprint ||
      input.readyPodUIDs.some((uid) => barrier.podUIDs.includes(uid)) ||
      new Set(input.readyPodUIDs).size !== input.readyPodUIDs.length
    )
      throw new DeliveryError(
        "CONFLICT",
        "Native restoration differs from the original producer UID/template or reuses a stopped Pod identity",
      );
    if (intent.barrierRestoredAt !== null) return intent;
    await tx.platformLock.delete({ where: { deploymentId: row.id } });
    const updated = await tx.recoveryIntent.update({
      where: { id },
      data: { barrierRestoredAt: new Date(input.observedAt) },
    });
    await audit(tx, actor, {
      action: "content.recovery_producer_restored",
      entityId: id,
      requestId: id,
      metadata: input,
    });
    return contentIntentView(updated);
  });
}
