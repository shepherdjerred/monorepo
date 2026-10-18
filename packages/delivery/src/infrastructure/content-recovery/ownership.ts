import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import {
  lock,
  required,
  fingerprint,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  ContentRecoveryIntentSchema,
  type ContentRecoveryOwnership,
} from "#shared/contract.ts";
import { heldContentRecovery } from "./context.ts";

export async function requireNoContentBarrier(tx: Transaction) {
  if (
    (await tx.contentRecoveryIntent.count({
      where: {
        dispatchBarrier: { not: Prisma.DbNull },
        barrierRestoredAt: null,
      },
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
  const raw = required(
    await tx.contentRecoveryIntent.findUnique({ where: { id } }),
    "Content recovery intent",
  );
  if (raw.status !== "pending")
    throw new DeliveryError("CONFLICT", "Content recovery intent is terminal");
  const initial = required(
    await tx.deployment.findUnique({ where: { id: raw.deploymentId } }),
    "Content recovery source",
  );
  await lock(tx, `environment:${initial.environmentId}`);
  const held = await heldContentRecovery(tx, raw);
  if (
    held.snapshotFingerprint !== raw.snapshotFingerprint ||
    held.targetKind !== raw.targetKind
  )
    throw new DeliveryError(
      "CONFLICT",
      "Content recovery original selection or ownership changed",
    );
  return { ...held, intent: ContentRecoveryIntentSchema.parse(wire(raw)) };
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
