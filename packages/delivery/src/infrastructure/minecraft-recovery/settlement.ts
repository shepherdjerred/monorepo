import type { Principal } from "#shared/contract.ts";
import {
  CompleteMinecraftRecoverySchema,
  FailMinecraftRecoverySchema,
  MinecraftRecoveryIntentSchema,
} from "#shared/minecraft-recovery-contract.ts";
import type { CompleteMinecraftRecovery } from "#shared/minecraft-recovery-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import { minecraftRecoveryOwnership } from "./ownership.ts";
import type { InspectMinecraftRecovery } from "./inspector.ts";

export async function completeMinecraftRecovery(
  this: Delivery,
  ...args: [
    intentId: string,
    input: CompleteMinecraftRecovery,
    actor: Principal,
    inspect: InspectMinecraftRecovery,
  ]
) {
  const [intentId, rawInput, actor, inspect] = args;
  requireScope(actor, "execute");
  const input = CompleteMinecraftRecoverySchema.parse(rawInput);
  const before = await this.minecraftRecovery(intentId, actor);
  const resultFingerprint = fingerprint(input);
  if (before.intent.status !== "pending") {
    const terminal = required(
      await this.database.minecraftRecoveryIntent.findUnique({
        where: { id: intentId },
      }),
      "Minecraft recovery intent",
    );
    if (
      terminal.status !== "succeeded" ||
      terminal.resultFingerprint !== resultFingerprint
    )
      throw new DeliveryError(
        "CONFLICT",
        "Minecraft recovery result is immutable",
      );
    return before.intent;
  }
  if (before.intent.controllerReceipt === null)
    throw new DeliveryError(
      "CONFLICT",
      "Minecraft recovery requires a recorded original native controller",
    );
  // No transaction or caller-supplied evidence spans this independent live read.
  const observation = await inspect(before.intent, before.deployment);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `minecraft-recovery:${intentId}`);
    const intent = required(
      await tx.minecraftRecoveryIntent.findUnique({ where: { id: intentId } }),
      "Minecraft recovery intent",
    );
    if (intent.status !== "pending")
      throw new DeliveryError(
        "CONFLICT",
        "Minecraft recovery result is immutable",
      );
    const context = await minecraftRecoveryOwnership(
      tx,
      intent.deploymentId,
      intent.expectedEnvironmentGeneration,
    );
    if (
      input.expectedEnvironmentGeneration !==
        intent.expectedEnvironmentGeneration ||
      input.snapshotFingerprint !== intent.snapshotFingerprint ||
      context.snapshotFingerprint !== intent.snapshotFingerprint ||
      fingerprint(intent.controllerReceipt) !==
        fingerprint(before.intent.controllerReceipt) ||
      Date.parse(observation.observedAt) < Date.now() - 30_000
    )
      throw new DeliveryError(
        "CONFLICT",
        "Minecraft recovery lost its frozen source, native receipt or environment generation",
      );
    await tx.applicationLock.delete({
      where: { deploymentId: intent.deploymentId },
    });
    await tx.environment.update({
      where: { id: context.environment.id },
      data: { activeDeploymentId: null },
    });
    await tx.deployment.update({
      where: { id: intent.deploymentId },
      data: { recoveryRequired: false },
    });
    const updated = await tx.minecraftRecoveryIntent.update({
      where: { id: intentId },
      data: {
        status: "succeeded",
        resultFingerprint,
        message:
          "Independent controller and Argo inspection proved the untouched original reopened before source selection; original deployment remains failed or canceled",
        finishedAt: new Date(),
      },
    });
    await audit(tx, actor, {
      action: "minecraft.recovery_completed",
      entityId: intent.deploymentId,
      requestId: intentId,
      metadata: {
        observation,
        snapshotFingerprint: intent.snapshotFingerprint,
        controllerReceipt: intent.controllerReceipt,
      },
    });
    return MinecraftRecoveryIntentSchema.parse(wire(updated));
  });
}

export async function failMinecraftRecovery(
  this: Delivery,
  ...args: [intentId: string, message: string, actor: Principal]
) {
  const [intentId, message, actor] = args;
  requireScope(actor, "execute");
  const input = FailMinecraftRecoverySchema.parse({ message });
  return this.database.$transaction(async (tx) => {
    await lock(tx, `minecraft-recovery:${intentId}`);
    const intent = required(
      await tx.minecraftRecoveryIntent.findUnique({ where: { id: intentId } }),
      "Minecraft recovery intent",
    );
    if (intent.status !== "pending") {
      if (
        intent.status !== "failed" ||
        intent.resultFingerprint !== fingerprint(input)
      )
        throw new DeliveryError(
          "CONFLICT",
          "Minecraft recovery result is immutable",
        );
      return MinecraftRecoveryIntentSchema.parse(wire(intent));
    }
    const updated = await tx.minecraftRecoveryIntent.update({
      where: { id: intentId },
      data: {
        status: "failed",
        message: input.message,
        resultFingerprint: fingerprint(input),
        finishedAt: new Date(),
      },
    });
    await audit(tx, actor, {
      action: "minecraft.recovery_failed",
      entityId: intent.deploymentId,
      requestId: intentId,
      metadata: input,
    });
    return MinecraftRecoveryIntentSchema.parse(wire(updated));
  });
}
