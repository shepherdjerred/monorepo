import { z } from "zod";
import { PipelineDefinitionSchema } from "#shared/contract.ts";
import { MinecraftControllerReceiptSchema } from "#shared/minecraft-recovery-contract.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  fingerprint,
  lock,
  required,
} from "#infrastructure/delivery-records.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import { requireNoContentBarrier } from "#infrastructure/content-recovery/ownership.ts";

const NativeEvidence = MinecraftControllerReceiptSchema.extend({
  adapter: z.literal("minecraft-preservation-controller"),
});
export function nativeControllers(
  entries: { summary: string; operationId: string | null }[],
  operationId: string,
) {
  return entries.flatMap((entry) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.summary);
    } catch (error) {
      if (error instanceof SyntaxError) return [];
      throw error;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("adapter" in parsed) ||
      parsed.adapter !== "minecraft-preservation-controller"
    )
      return [];
    const { adapter: _adapter, ...receipt } = NativeEvidence.parse(parsed);
    if (receipt.requestId !== operationId || entry.operationId !== receipt.uid)
      throw new DeliveryError(
        "CONFLICT",
        "Recorded Minecraft native controller belongs to another operation",
      );
    return [receipt];
  });
}

export async function minecraftRecoveryOwnership(
  tx: Transaction,
  deploymentId: string,
  expectedGeneration: number,
) {
  await lock(tx, "delivery:claim");
  await requireNoContentBarrier(tx);
  await lock(tx, `deployment:${deploymentId}`);
  const deployment = required(
    await tx.deployment.findUnique({ where: { id: deploymentId } }),
    "Minecraft deployment",
  );
  await lock(tx, `environment:${deployment.environmentId}`);
  const environment = await tx.environment.findUniqueOrThrow({
    where: { id: deployment.environmentId },
  });
  const held = await tx.applicationLock.findUnique({ where: { deploymentId } });
  if (
    !deployment.recoveryRequired ||
    !["failed", "canceled"].includes(deployment.status) ||
    environment.activeDeploymentId !== deployment.id ||
    environment.generation !== expectedGeneration ||
    held?.application !== "minecraft-tsmc"
  )
    throw new DeliveryError(
      "CONFLICT",
      "Recovery no longer owns the same quarantined Minecraft deployment, source lock and environment generation",
    );
  const revision = await tx.pipeline.findUniqueOrThrow({
    where: { id: deployment.pipelineRevisionId },
  });
  const pipeline = PipelineDefinitionSchema.parse(revision.definition);
  if (
    deployment.serviceId !== "minecraft" ||
    environment.id !== "minecraft/tsmc" ||
    environment.application !== "minecraft-tsmc" ||
    pipeline.kind !== "argocd" ||
    pipeline.application !== "minecraft-tsmc" ||
    pipeline.minecraftUpgrade === undefined
  )
    throw new DeliveryError(
      "INVALID",
      "Independent recovery is restricted to the reviewed routine TSMC upgrade",
    );
  const stages = await tx.stage.findMany({ where: { deploymentId } });
  if (stages.some((stage) => stage.key === "reconcile"))
    throw new DeliveryError(
      "CONFLICT",
      "Minecraft source selection was admitted; use the independent restoration procedure and retain ownership",
    );
  const operationId = deliveryOperationId(
    `${deploymentId}:minecraft-preservation`,
  );
  if (
    stages.some(
      (stage) =>
        stage.key.startsWith("minecraft-preservation-") &&
        stage.operationId !== operationId,
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Minecraft preservation intent belongs to another native operation",
    );
  const receipts = nativeControllers(
    await tx.evidence.findMany({ where: { deploymentId, kind: "preflight" } }),
    operationId,
  );
  const uniqueReceipts = [
    ...new Map(
      receipts.map((receipt) => [fingerprint(receipt), receipt]),
    ).values(),
  ].sort((a, b) => a.uid.localeCompare(b.uid));
  const snapshotFingerprint = fingerprint({
    id: deployment.id,
    environmentId: deployment.environmentId,
    versionSetRevisionId: deployment.versionSetRevisionId,
    pipelineRevisionId: deployment.pipelineRevisionId,
    configurationRevision: deployment.configurationRevision,
    configuration: deployment.configuration,
    previousAcceptedVersionSetRevisionId:
      deployment.previousAcceptedVersionSetRevisionId,
    previousAcceptedConfiguration: deployment.previousAcceptedConfiguration,
    pipeline,
    operationId,
    nativeControllers: uniqueReceipts,
  });
  return {
    deployment,
    environment,
    pipeline,
    operationId,
    nativeControllers: uniqueReceipts,
    snapshotFingerprint,
  };
}
