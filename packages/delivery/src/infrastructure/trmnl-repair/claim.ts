import type { Deployment } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  deliveryWorkflowId,
  type Principal,
  type TrmnlRepairClaim,
} from "#shared/contract.ts";
import {
  environment,
  id,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { audit, lock, required } from "#infrastructure/delivery-records.ts";

function requireSameTarget(row: Deployment, source: Deployment) {
  if (
    source.environmentId !== row.environmentId ||
    !["failed", "canceled"].includes(source.status) ||
    row.pipelineRevisionId !== source.pipelineRevisionId ||
    row.versionSetRevisionId !== source.versionSetRevisionId ||
    row.configurationId !== source.configurationId
  )
    throw new DeliveryError(
      "CONFLICT",
      "TRMNL repair must preserve the failed release's exact frozen inputs",
    );
}

/** Transfers the existing quarantine only after the original executor is closed. */
export async function claimTrmnlRepair(
  tx: Transaction,
  row: Deployment,
  proof: TrmnlRepairClaim | undefined,
  actor: Principal,
) {
  if (proof === undefined || row.repairOfDeploymentId === null)
    throw new DeliveryError(
      "INVALID",
      "TRMNL repair requires a fresh closed-source Workflow observation",
    );
  const age = Date.now() - Date.parse(proof.observedAt);
  if (
    age < -5000 ||
    age > 60_000 ||
    proof.sourceWorkflow.workflowId !==
      deliveryWorkflowId(row.repairOfDeploymentId)
  )
    throw new DeliveryError(
      "CONFLICT",
      "TRMNL repair source Workflow proof is stale or belongs to another release",
    );
  await lock(tx, `environment:${row.environmentId}`);
  const env = await environment(tx, row.environmentId);
  const source = required(
    await tx.deployment.findUnique({ where: { id: row.repairOfDeploymentId } }),
    "Repair source",
  );
  const running = row.status === "running";
  requireSameTarget(row, source);
  const owner = running ? row.id : source.id;
  const held = await tx.targetLock.findUnique({
    where: { instance: "application:trmnl-dashboard" },
  });
  if (
    env.application !== "trmnl-dashboard" ||
    env.serviceId !== "trmnl-dashboard" ||
    (!running && !source.recoveryRequired) ||
    env.activeDeploymentId !== owner ||
    held?.deploymentId !== owner ||
    env.generation !== row.expectedGeneration ||
    proof.expectedEnvironmentGeneration !== env.generation
  )
    throw new DeliveryError(
      "CONFLICT",
      "TRMNL repair quarantine ownership or generation changed",
    );
  if (!running) {
    if (row.status !== "queued")
      throw new DeliveryError("CONFLICT", "TRMNL repair is not queued");
    // Every lock of the quarantined source moves to the repair (T1); only
    // acceptance moves the generation (E1).
    await tx.targetLock.updateMany({
      where: { deploymentId: source.id },
      data: { deploymentId: row.id },
    });
    await tx.platformLock.updateMany({
      where: { deploymentId: source.id },
      data: { deploymentId: row.id },
    });
    await tx.environment.update({
      where: { id: env.id },
      data: { activeDeploymentId: row.id },
    });
    await tx.deployment.update({
      where: { id: source.id },
      data: { recoveryRequired: false },
    });
    await tx.deployment.update({
      where: { id: row.id },
      data: { status: "running", startedAt: new Date() },
    });
  }
  await audit(tx, actor, {
    action: "trmnl.repair_claimed",
    entityId: row.id,
    requestId: id(),
    metadata: proof,
  });
}
