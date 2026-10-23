import { DeliveryError } from "#domain/error.ts";
import { deliveryWorkflowId, type Principal } from "#shared/contract.ts";
import { monitorOf } from "#shared/model/recipe-view.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { id } from "#infrastructure/delivery-data.ts";
import {
  audit,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  ACCEPTING_KINDS,
  rollbackCandidates,
} from "#infrastructure/selection/candidates.ts";

type Row = {
  id: string;
  environmentId: string;
  versionSetRevisionId: string;
  pipelineRevisionId: string;
  configurationId: string;
  finishedAt: Date | null;
};

function sameSelection(left: Row, right: Row) {
  return (
    left.versionSetRevisionId === right.versionSetRevisionId &&
    left.pipelineRevisionId === right.pipelineRevisionId &&
    left.configurationId === right.configurationId
  );
}

/** The last settled selection D9 permits, newest first; null holds the environment. */
async function restorationTarget(this: Delivery, alarmed: Row) {
  const candidates = await rollbackCandidates(
    this.database,
    alarmed.environmentId,
  );
  const eligible = new Set(
    candidates
      .filter((candidate) => candidate.eligible)
      .map((candidate) => candidate.deploymentId),
  );
  const earlier = await this.database.deployment.findMany({
    where: {
      environmentId: alarmed.environmentId,
      status: "succeeded",
      kind: { in: ACCEPTING_KINDS },
      monitorState: { in: ["settled", "unmonitored"] },
      finishedAt: { lt: alarmed.finishedAt ?? new Date(0) },
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    include: { approval: true },
  });
  return (
    earlier.find(
      (row) => eligible.has(row.id) && !sameSelection(row, alarmed),
    ) ?? null
  );
}

async function hold(
  this: Delivery,
  alarmed: Row,
  actor: Principal,
  reason: string,
) {
  await this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${alarmed.id}`);
    const held = await tx.audit.findFirst({
      where: { entityId: alarmed.id, action: "monitor.held" },
    });
    if (held === null)
      await audit(tx, actor, {
        action: "monitor.held",
        entityId: alarmed.id,
        requestId: id(),
        metadata: { reason },
      });
  });
  return null;
}

/**
 * W2, H5: an alarm under `automatic` policy requests a rollback to the last
 * settled selection D9 permits, authorised by a restoration approval that
 * carries the restored selection's own approver where policy requires one.
 * With no permitted candidate the environment is held for an operator.
 * Idempotent: the request id names the alarmed deployment.
 */
export async function requestMonitorRollback(
  this: Delivery,
  alarmedId: string,
  actor: Principal,
) {
  const alarmed = await this.database.deployment.findUniqueOrThrow({
    where: { id: alarmedId },
  });
  const env = await this.database.environment.findUniqueOrThrow({
    where: { id: alarmed.environmentId },
  });
  if (
    alarmed.monitorState !== "alarmed" ||
    env.acceptedDeploymentId !== alarmed.id
  )
    return null;
  const monitor = monitorOf(
    PipelineRevisionSchema.parse(
      wire(
        required(
          await this.database.pipeline.findUnique({
            where: { id: alarmed.pipelineRevisionId },
          }),
          "Recipe",
        ),
      ),
    ).definition,
  );
  if (monitor?.policy !== "automatic") return null;
  const target = await restorationTarget.call(this, alarmed);
  if (target === null)
    return hold.call(
      this,
      alarmed,
      actor,
      "no settled selection is a permitted rollback candidate",
    );
  const grant = target.approval;
  if (env.approvalPolicy === "required" && grant?.status !== "granted")
    return hold.call(
      this,
      alarmed,
      actor,
      `restoration target ${target.id} was never approved`,
    );
  const deployment = await this.createDeployment(
    {
      requestId: `monitor/${alarmed.id}/rollback`,
      environmentId: env.id,
      expectedGeneration: env.generation,
      kind: "rollback",
      selectionDeploymentId: target.id,
      message: `Automatic rollback after ${alarmed.id} alarmed`,
    },
    actor,
    true,
  );
  if (grant === null || deployment.status !== "awaiting_approval")
    return deployment;
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deployment.id}`);
    const pending = await tx.approval.findUniqueOrThrow({
      where: { deploymentId: deployment.id },
    });
    if (pending.status !== "pending") return deployment;
    if (grant.actor === null || grant.reason === null)
      throw new DeliveryError(
        "CONFLICT",
        "Restored approval lost its approver",
      );
    const now = new Date();
    await tx.approval.update({
      where: { id: pending.id },
      data: {
        status: "granted",
        actor: grant.actor,
        reason: `Restoration of ${target.id}, approved by ${grant.actor}: ${grant.reason}`,
        decidedAt: now,
        restorationOfDeploymentId: target.id,
      },
    });
    const queued = await tx.deployment.update({
      where: { id: deployment.id },
      data: { status: "queued" },
    });
    await tx.outbox.create({
      data: {
        deploymentId: deployment.id,
        workflowId: deliveryWorkflowId(deployment.id),
      },
    });
    await audit(tx, actor, {
      action: "deployment.restoration_approved",
      entityId: deployment.id,
      requestId: id(),
      metadata: { restoredDeploymentId: target.id, approver: grant.actor },
    });
    return queued;
  });
}
