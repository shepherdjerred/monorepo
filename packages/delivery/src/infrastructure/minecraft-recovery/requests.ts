import type { Principal } from "#shared/contract.ts";
import {
  MinecraftControllerReceiptSchema,
  MinecraftRecoveryIntentSchema,
  RequestMinecraftRecoverySchema,
} from "#shared/minecraft-recovery-contract.ts";
import type {
  RequestMinecraftRecovery,
  MinecraftControllerReceipt,
} from "#shared/minecraft-recovery-contract.ts";
import type { RecoveryIntent } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  remember,
  request,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  bareFingerprint,
  createIntent,
  findIntent,
  intentDetail,
  legacyIntentFields,
  updateIntentDetail,
} from "#infrastructure/recovery-intents.ts";
import { minecraftRecoveryOwnership } from "./ownership.ts";

/** The minecraft-kind view of a unified recovery intent row. */
export function minecraftIntentView(row: RecoveryIntent) {
  return MinecraftRecoveryIntentSchema.parse(
    wire({
      ...legacyIntentFields(row),
      controllerReceipt: intentDetail(row)["controllerReceipt"] ?? null,
    }),
  );
}

export async function requestMinecraftRecovery(
  this: Delivery,
  ...args: [
    deploymentId: string,
    input: RequestMinecraftRecovery,
    actor: Principal,
  ]
) {
  const [deploymentId, rawInput, actor] = args;
  requireScope(actor, "admin");
  const input = RequestMinecraftRecoverySchema.parse(rawInput);
  const requestInput = { deploymentId, ...input };
  return this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "minecraft-recovery",
    });
    if (prior !== null)
      return minecraftIntentView(
        await findIntent(tx, prior.resultId, "minecraft"),
      );
    const context = await minecraftRecoveryOwnership(
      tx,
      deploymentId,
      input.expectedEnvironmentGeneration,
    );
    if (
      (await tx.recoveryIntent.findFirst({
        where: { deploymentId, status: "pending" },
      })) !== null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Minecraft deployment already has a pending recovery intent",
      );
    await tx.deployment.update({
      where: { id: deploymentId },
      data: { cancelRequested: true },
    });
    const intent = await createIntent(tx, {
      id: input.requestId,
      kind: "minecraft",
      deploymentId,
      requestedBy: actor.id,
      reason: input.reason,
      expectedGeneration: input.expectedEnvironmentGeneration,
      snapshotFingerprint: context.snapshotFingerprint,
      workflowId: `delivery-minecraft-recovery/${input.requestId}`,
    });
    await remember(tx, actor, {
      requestId: input.requestId,
      input: requestInput,
      resultType: "minecraft-recovery",
      resultId: intent.id,
    });
    await audit(tx, actor, {
      action: "minecraft.recovery_requested",
      entityId: deploymentId,
      requestId: input.requestId,
      metadata: {
        reason: input.reason,
        snapshotFingerprint: context.snapshotFingerprint,
      },
    });
    return minecraftIntentView(intent);
  });
}

export async function minecraftRecovery(
  this: Delivery,
  intentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const intent = minecraftIntentView(
    await findIntent(this.database, intentId, "minecraft"),
  );
  return { intent, deployment: await this.detail(intent.deploymentId) };
}

export async function pendingMinecraftRecovery(
  this: Delivery,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const intents = await this.database.recoveryIntent.findMany({
    where: { kind: "minecraft", status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return { intents: intents.map((intent) => minecraftIntentView(intent)) };
}

export async function submittedMinecraftRecovery(
  this: Delivery,
  ...args: [intentId: string, workflowId: string, actor: Principal]
) {
  const [intentId, workflowId, actor] = args;
  requireScope(actor, "execute");
  const intent = await findIntent(this.database, intentId, "minecraft");
  if (intent.workflowId !== workflowId || intent.status !== "pending")
    throw new DeliveryError(
      "CONFLICT",
      "Recovery submission does not match the pending immutable Workflow",
    );
  return minecraftIntentView(
    await this.database.recoveryIntent.update({
      where: { id: intentId },
      data: { submittedAt: intent.submittedAt ?? new Date() },
    }),
  );
}

export async function recordMinecraftRecoveryController(
  this: Delivery,
  ...args: [
    intentId: string,
    receipt: MinecraftControllerReceipt,
    actor: Principal,
  ]
) {
  const [intentId, rawReceipt, actor] = args;
  requireScope(actor, "execute");
  const receipt = MinecraftControllerReceiptSchema.parse(rawReceipt);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `minecraft-recovery:${intentId}`);
    const intent = await findIntent(tx, intentId, "minecraft");
    if (intent.status !== "pending")
      throw new DeliveryError("CONFLICT", "Recovery result is immutable");
    const context = await minecraftRecoveryOwnership(
      tx,
      intent.deploymentId,
      intent.expectedGeneration,
    );
    if (
      context.snapshotFingerprint !== bareFingerprint(intent.fingerprint) ||
      receipt.requestId !== context.operationId
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery native receipt no longer matches its frozen source owner",
      );
    const recorded = intentDetail(intent)["controllerReceipt"];
    const prior =
      recorded === undefined || recorded === null
        ? null
        : MinecraftControllerReceiptSchema.parse(recorded);
    if (
      prior !== null &&
      (prior.specFingerprint !== receipt.specFingerprint ||
        prior.sourceFingerprint !== receipt.sourceFingerprint)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery cannot replace its original native source snapshot",
      );
    if (
      context.nativeControllers.some(
        (original) =>
          original.specFingerprint !== receipt.specFingerprint ||
          original.sourceFingerprint !== receipt.sourceFingerprint,
      )
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery controller differs from the original preservation source snapshot",
      );
    const updated = await updateIntentDetail(tx, intentId, {
      controllerReceipt: receipt,
    });
    await audit(tx, actor, {
      action: "minecraft.recovery_controller_recorded",
      entityId: intent.deploymentId,
      requestId: intentId,
      metadata: {
        receiptFingerprint: fingerprint(receipt),
        controllerUid: receipt.uid,
      },
    });
    return minecraftIntentView(updated);
  });
}
