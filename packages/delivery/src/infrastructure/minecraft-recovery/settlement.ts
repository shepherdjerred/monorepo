import type { Principal } from "#shared/contract.ts";
import {
  CompleteMinecraftRecoverySchema,
  FailMinecraftRecoverySchema,
} from "#shared/minecraft-recovery-contract.ts";
import type { CompleteMinecraftRecovery } from "#shared/minecraft-recovery-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { audit, fingerprint, lock } from "#infrastructure/delivery-records.ts";
import {
  bareFingerprint,
  findIntent,
  intentDetail,
} from "#infrastructure/recovery-intents.ts";
import { releaseTerminalOwnership } from "#infrastructure/terminal-ownership.ts";
import { minecraftIntentView } from "./requests.ts";
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
    const terminal = await findIntent(this.database, intentId, "minecraft");
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
    const intent = await findIntent(tx, intentId, "minecraft");
    if (intent.status !== "pending")
      throw new DeliveryError(
        "CONFLICT",
        "Minecraft recovery result is immutable",
      );
    const snapshotFingerprint = bareFingerprint(intent.fingerprint);
    const context = await minecraftRecoveryOwnership(
      tx,
      intent.deploymentId,
      intent.expectedGeneration,
    );
    const controllerReceipt = intentDetail(intent)["controllerReceipt"];
    if (
      input.expectedEnvironmentGeneration !== intent.expectedGeneration ||
      input.snapshotFingerprint !== snapshotFingerprint ||
      context.snapshotFingerprint !== snapshotFingerprint ||
      fingerprint(controllerReceipt) !==
        fingerprint(before.intent.controllerReceipt) ||
      Date.parse(observation.observedAt) < Date.now() - 30_000
    )
      throw new DeliveryError(
        "CONFLICT",
        "Minecraft recovery lost its frozen source, native receipt or environment generation",
      );
    await tx.deployment.update({
      where: { id: intent.deploymentId },
      data: { recoveryRequired: false },
    });
    await releaseTerminalOwnership(tx, intent.deploymentId);
    const updated = await tx.recoveryIntent.update({
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
        snapshotFingerprint,
        controllerReceipt: before.intent.controllerReceipt,
      },
    });
    return minecraftIntentView(updated);
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
    const intent = await findIntent(tx, intentId, "minecraft");
    if (intent.status !== "pending") {
      if (
        intent.status !== "failed" ||
        intent.resultFingerprint !== fingerprint(input)
      )
        throw new DeliveryError(
          "CONFLICT",
          "Minecraft recovery result is immutable",
        );
      return minecraftIntentView(intent);
    }
    const updated = await tx.recoveryIntent.update({
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
    return minecraftIntentView(updated);
  });
}
