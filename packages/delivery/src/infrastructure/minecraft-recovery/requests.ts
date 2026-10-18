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
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  remember,
  request,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { minecraftRecoveryOwnership } from "./ownership.ts";

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
      return MinecraftRecoveryIntentSchema.parse(
        wire(
          required(
            await tx.minecraftRecoveryIntent.findUnique({
              where: { id: prior.resultId },
            }),
            "Minecraft recovery intent",
          ),
        ),
      );
    const context = await minecraftRecoveryOwnership(
      tx,
      deploymentId,
      input.expectedEnvironmentGeneration,
    );
    if (
      (await tx.minecraftRecoveryIntent.findFirst({
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
    const intent = await tx.minecraftRecoveryIntent.create({
      data: {
        id: input.requestId,
        deploymentId,
        requestedBy: actor.id,
        reason: input.reason,
        expectedEnvironmentGeneration: input.expectedEnvironmentGeneration,
        snapshotFingerprint: context.snapshotFingerprint,
        workflowId: `delivery-minecraft-recovery/${input.requestId}`,
      },
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
    return MinecraftRecoveryIntentSchema.parse(wire(intent));
  });
}

export async function minecraftRecovery(
  this: Delivery,
  intentId: string,
  actor: Principal,
) {
  requireScope(actor, "read");
  const intent = MinecraftRecoveryIntentSchema.parse(
    wire(
      required(
        await this.database.minecraftRecoveryIntent.findUnique({
          where: { id: intentId },
        }),
        "Minecraft recovery intent",
      ),
    ),
  );
  return { intent, deployment: await this.detail(intent.deploymentId) };
}

export async function pendingMinecraftRecovery(
  this: Delivery,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const intents = await this.database.minecraftRecoveryIntent.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return {
    intents: intents.map((intent) =>
      MinecraftRecoveryIntentSchema.parse(wire(intent)),
    ),
  };
}

export async function submittedMinecraftRecovery(
  this: Delivery,
  ...args: [intentId: string, workflowId: string, actor: Principal]
) {
  const [intentId, workflowId, actor] = args;
  requireScope(actor, "execute");
  const intent = required(
    await this.database.minecraftRecoveryIntent.findUnique({
      where: { id: intentId },
    }),
    "Minecraft recovery intent",
  );
  if (intent.workflowId !== workflowId || intent.status !== "pending")
    throw new DeliveryError(
      "CONFLICT",
      "Recovery submission does not match the pending immutable Workflow",
    );
  return MinecraftRecoveryIntentSchema.parse(
    wire(
      await this.database.minecraftRecoveryIntent.update({
        where: { id: intentId },
        data: { submittedAt: intent.submittedAt ?? new Date() },
      }),
    ),
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
    const intent = required(
      await tx.minecraftRecoveryIntent.findUnique({ where: { id: intentId } }),
      "Minecraft recovery intent",
    );
    if (intent.status !== "pending")
      throw new DeliveryError("CONFLICT", "Recovery result is immutable");
    const context = await minecraftRecoveryOwnership(
      tx,
      intent.deploymentId,
      intent.expectedEnvironmentGeneration,
    );
    if (
      context.snapshotFingerprint !== intent.snapshotFingerprint ||
      receipt.requestId !== context.operationId
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery native receipt no longer matches its frozen source owner",
      );
    const prior =
      intent.controllerReceipt === null
        ? null
        : MinecraftControllerReceiptSchema.parse(intent.controllerReceipt);
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
    const updated = await tx.minecraftRecoveryIntent.update({
      where: { id: intentId },
      data: { controllerReceipt: receipt },
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
    return MinecraftRecoveryIntentSchema.parse(wire(updated));
  });
}
