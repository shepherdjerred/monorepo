import { DeliveryError } from "#domain/error.ts";
import { DeploymentSchema, deliveryWorkflowId } from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import { wire, lock, required, audit } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { terminal, id } from "./delivery-data.ts";

export async function pending(this: Delivery) {
  const rows = await this.database.outbox.findMany({
    where: { submittedAt: null, deployment: { status: "queued" } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { deployment: true },
  });
  return {
    deployments: rows.map((entry) =>
      DeploymentSchema.parse(wire(entry.deployment)),
    ),
  };
}

export async function monitor(this: Delivery) {
  const rows = await this.database.outbox.findMany({
    where: {
      deployment: { status: { in: ["queued", "running"] } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { deployment: true },
  });
  return {
    deployments: rows.map((entry) => ({
      id: entry.deploymentId,
      status: entry.deployment.status,
      workflowId: entry.workflowId,
      submitted: entry.submittedAt !== null,
    })),
  };
}

export async function orphan(
  this: Delivery,
  deploymentId: string,
  input: { workflowId: string; reason: string; workflowStatus: string },
  actor: Principal,
) {
  if (input.workflowId !== deliveryWorkflowId(deploymentId))
    throw new DeliveryError(
      "INVALID",
      "Workflow identity differs from this deployment",
    );
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({
        where: { id: deploymentId },
        include: { stages: true },
      }),
      "Deployment",
    );
    if (terminal.has(row.status)) return DeploymentSchema.parse(wire(row));
    if (!["queued", "running"].includes(row.status))
      throw new DeliveryError(
        "CONFLICT",
        "Deployment has no submitted workflow to recover",
      );
    const recoveryRequired = row.stages.some(
      (entry) => entry.status === "running",
    );
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "failed",
        recoveryRequired,
        message: `Workflow ${input.workflowStatus}: ${input.reason}`,
        finishedAt: new Date(),
      },
    });
    if (!recoveryRequired) {
      await tx.applicationLock.deleteMany({ where: { deploymentId } });
      await tx.platformLock.deleteMany({ where: { deploymentId } });
      await tx.environment.updateMany({
        where: { id: row.environmentId, activeDeploymentId: deploymentId },
        data: { activeDeploymentId: null },
      });
    }
    await tx.outbox.deleteMany({ where: { deploymentId } });
    await audit(tx, actor, {
      action: "deployment.orphan_recovered",
      entityId: deploymentId,
      requestId: id(),
      metadata: {
        workflowId: input.workflowId,
        workflowStatus: input.workflowStatus,
        reason: input.reason,
      },
    });
    return DeploymentSchema.parse(wire(updated));
  });
}

export async function submitted(
  this: Delivery,
  deploymentId: string,
  workflowId: string,
) {
  if (workflowId !== deliveryWorkflowId(deploymentId))
    throw new DeliveryError(
      "INVALID",
      "Workflow identity must match deployment",
    );
  await this.database.outbox.updateMany({
    where: { deploymentId, workflowId, submittedAt: null },
    data: { submittedAt: new Date() },
  });
  return { accepted: true };
}
