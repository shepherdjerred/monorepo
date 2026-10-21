import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { audit, fingerprint } from "#infrastructure/delivery-records.ts";
import { evidence } from "#infrastructure/delivery-data.ts";
import {
  AdmitContentRecoveryRepairSchema,
  CompleteContentRecoverySchema,
  type AdmitContentRecoveryRepair,
  type CompleteContentRecovery,
  type Principal,
} from "#shared/contract.ts";
import { findIntent } from "#infrastructure/recovery-intents.ts";
import {
  pendingContentIntent,
  requireFreshContentObservation,
} from "./ownership.ts";
import { contentIntentView } from "./context.ts";
import { inspectContentProof } from "./proof.ts";
import { settleRecoveryTarget } from "#infrastructure/recovery-settlement.ts";

export async function admitContentRecoveryRepair(
  this: Delivery,
  id: string,
  raw: AdmitContentRecoveryRepair,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = AdmitContentRecoveryRepairSchema.parse(raw);
  const before = await inspectContentProof(this, id, input, {
    activeRepairJobUIDs: input.activeRepairJobUIDs,
  });
  return this.database.$transaction(async (tx) => {
    const held = await pendingContentIntent(tx, id);
    requireFreshContentObservation(input.observedAt);
    if (fingerprint(held.intent) !== fingerprint(before.intent))
      throw new DeliveryError(
        "CONFLICT",
        "Content recovery native checkpoints changed after inspection",
      );
    const global = await tx.platformLock.findUnique({
      where: { id: "platform" },
    });
    if (global?.deploymentId !== held.row.id)
      throw new DeliveryError(
        "CONFLICT",
        "Content repair lost its global producer barrier",
      );
    await audit(tx, actor, {
      action: "content.recovery_repair_admitted",
      entityId: id,
      requestId: id,
      metadata: input,
    });
    return held.intent;
  });
}

export async function completeContentRecovery(
  this: Delivery,
  id: string,
  raw: CompleteContentRecovery,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = CompleteContentRecoverySchema.parse(raw);
  const existing = await findIntent(this.database, id, "content");
  if (existing.status !== "pending") {
    if (
      existing.status !== "succeeded" ||
      existing.resultFingerprint !== fingerprint(input)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Content recovery settlement is immutable",
      );
    return contentIntentView(existing);
  }
  const before = await inspectContentProof(this, id, input);
  if (
    before.expectedSettlements[input.settlement.state] !==
    input.settlement.fingerprint
  )
    throw new DeliveryError(
      "CONFLICT",
      "Native content settlement does not match the exact frozen desired or genuine prior release",
    );
  return this.database.$transaction(async (tx) => {
    const { intent, row, env } = await pendingContentIntent(tx, id);
    requireFreshContentObservation(input.observedAt);
    if (fingerprint(intent) !== fingerprint(before.intent))
      throw new DeliveryError(
        "CONFLICT",
        "Content native checkpoints changed after independent settlement",
      );
    const global = await tx.platformLock.findUnique({
      where: { id: "platform" },
    });
    if (global?.deploymentId !== row.id)
      throw new DeliveryError(
        "CONFLICT",
        "Content settlement lost its exact global producer barrier",
      );
    await evidence(
      tx,
      row.id,
      [
        {
          kind: "reconciliation",
          operationId: id,
          summary: JSON.stringify({
            adapter: "content-recovery/v1",
            intentId: id,
            settlement: input.settlement,
            observedAt: input.observedAt,
            proofSummary: input.proofSummary,
          }),
        },
      ],
      `content-recovery/${id}`,
    );
    await settleRecoveryTarget(tx, {
      deploymentId: row.id,
      environmentId: env.id,
      expectedGeneration: env.generation,
      releaseGlobal: false,
    });
    const updated = await tx.recoveryIntent.update({
      where: { id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        resultFingerprint: fingerprint(input),
        message: input.proofSummary,
      },
    });
    await audit(tx, actor, {
      action: "content.recovery_completed",
      entityId: id,
      requestId: id,
      metadata: input,
    });
    return contentIntentView(updated);
  });
}
