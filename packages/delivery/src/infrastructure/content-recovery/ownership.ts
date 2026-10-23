import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { lock, fingerprint } from "#infrastructure/delivery-records.ts";
import type {
  ContentRecoveryIntentSchema,
  ContentRecoveryOwnership,
} from "#shared/contract.ts";
import {
  bareFingerprint,
  findIntent,
  intentDetail,
} from "#infrastructure/recovery-intents.ts";
import { contentIntentView, heldContentRecovery } from "./context.ts";

/** An intent that journaled the shared producer barrier holds it until native restoration (model D8). */
export async function requireNoContentBarrier(tx: Transaction) {
  if (
    (await tx.recoveryIntent.count({
      where: { barrier: { not: Prisma.DbNull }, barrierRestoredAt: null },
    })) !== 0
  )
    throw new DeliveryError(
      "BUSY",
      "Independent content recovery holds the journaled global producer barrier until exact native restoration",
    );
}

export async function pendingContentIntent(tx: Transaction, id: string) {
  await lock(tx, "delivery:claim");
  await lock(tx, `content-recovery:${id}`);
  const raw = await findIntent(tx, id, "content");
  if (raw.status !== "pending")
    throw new DeliveryError("CONFLICT", "Content recovery intent is terminal");
  await lock(tx, `deployment:${raw.deploymentId}`);
  const initial = await tx.deployment.findUniqueOrThrow({
    where: { id: raw.deploymentId },
  });
  await lock(tx, `environment:${initial.environmentId}`);
  const held = await heldContentRecovery(tx, {
    deploymentId: raw.deploymentId,
    expectedEnvironmentGeneration: raw.expectedGeneration,
  });
  if (
    held.snapshotFingerprint !== bareFingerprint(raw.fingerprint) ||
    held.targetKind !== intentDetail(raw)["targetKind"]
  )
    throw new DeliveryError(
      "CONFLICT",
      "Content recovery original selection or ownership changed",
    );
  return { ...held, intent: contentIntentView(raw), stored: raw };
}

export function requireFreshContentObservation(observedAt: string) {
  const age = Date.now() - Date.parse(observedAt);
  if (age < -5000 || age > 60_000)
    throw new DeliveryError(
      "CONFLICT",
      "Independent content observations must be fresh within sixty seconds",
    );
}

export function requireContentQuiescence(
  intent: ReturnType<typeof ContentRecoveryIntentSchema.parse>,
  input: ContentRecoveryOwnership,
) {
  requireFreshContentObservation(input.observedAt);
  const barrier = intent.dispatchBarrier;
  if (
    barrier === null ||
    intent.barrierRestoredAt !== null ||
    input.expectedEnvironmentGeneration !==
      intent.expectedEnvironmentGeneration ||
    input.snapshotFingerprint !== intent.snapshotFingerprint ||
    input.sourceWorkflow.workflowId !== `delivery/${intent.deploymentId}` ||
    input.quiescence.journalFingerprint !== fingerprint(barrier) ||
    input.quiescence.deploymentUID !== barrier.deploymentUID ||
    input.quiescence.templateFingerprint !== barrier.templateFingerprint
  )
    throw new DeliveryError(
      "CONFLICT",
      "Content recovery must independently fence the original closed executor and exact journaled zero-replica host",
    );
}
