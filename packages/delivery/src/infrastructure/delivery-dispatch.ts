import { DeliveryError } from "#domain/error.ts";
import {
  DeploymentSchema,
  deliverySuccessorWorkflowId,
  deliveryWorkflowId,
} from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import { wire, lock, required, audit } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { terminal, id } from "./delivery-data.ts";
import { releaseTerminalOwnership } from "./terminal-ownership.ts";

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
      // The Workflow that owns it now; a successor after a handoff (D8).
      ownerWorkflowId: entry.deployment.workflowId,
      handoff: entry.deployment.handoffAt !== null,
    })),
  };
}

export async function orphan(
  this: Delivery,
  deploymentId: string,
  input: { workflowId: string; reason: string; workflowStatus: string },
  actor: Principal,
) {
  if (
    ![
      deliveryWorkflowId(deploymentId),
      deliverySuccessorWorkflowId(deploymentId),
    ].includes(input.workflowId)
  )
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
    const successor = deliverySuccessorWorkflowId(deploymentId);
    // The outgoing executor closes by design after a handoff; the marker
    // passes ownership to the one successor until it claims (D8).
    if (row.handoffAt !== null && input.workflowId !== successor)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment awaits its successor executor; its outgoing Workflow closing is expected",
      );
    const owner =
      row.handoffAt === null
        ? (row.workflowId ?? deliveryWorkflowId(deploymentId))
        : successor;
    if (owner !== input.workflowId)
      throw new DeliveryError(
        "CONFLICT",
        "A closed Workflow that does not own this deployment cannot orphan it",
      );
    // A handed-off deployment's self-hosted change is applied, and only its
    // successor's verified acceptance settles it. A successor that closed
    // before or after claiming leaves it recovery-required with its locks
    // and dispatch barrier held, as failDeliveryHandoff does (D5, D8).
    const recoveryRequired =
      owner === successor ||
      row.stages.some((entry) => entry.status === "running");
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "failed",
        recoveryRequired,
        message: `Workflow ${input.workflowStatus}: ${input.reason}`,
        finishedAt: new Date(),
      },
    });
    if (!recoveryRequired) await releaseTerminalOwnership(tx, deploymentId);
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
