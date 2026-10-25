import type { Principal } from "#shared/contract.ts";
import {
  MinecraftControllerReceiptSchema,
  MinecraftRecoveryIntentSchema,
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
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  bareFingerprint,
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

export function requestMinecraftRecovery(
  this: Delivery,
  _deploymentId: string,
  _input: RequestMinecraftRecovery,
  actor: Principal,
): never {
  requireScope(actor, "admin");
  throw new DeliveryError(
    "INVALID",
    "Minecraft recovery was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
  );
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
