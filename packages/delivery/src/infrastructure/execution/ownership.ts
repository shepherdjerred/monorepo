import { DeliveryError } from "#domain/error.ts";
import {
  DeploymentSchema,
  deliverySuccessorWorkflowId,
} from "#shared/contract.ts";
import type {
  ExecutorIdentity,
  PipelineDefinition,
  Principal,
} from "#shared/contract.ts";
import {
  wire,
  lock,
  required,
  audit,
} from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { id, type Transaction } from "#infrastructure/delivery-data.ts";

/** A deployment row as admission and finish read it. */
export type DeploymentRow = NonNullable<
  Awaited<ReturnType<Transaction["deployment"]["findUnique"]>>
>;

export function observesApplication(row: {
  kind: string;
  platformSnapshot: unknown;
  controlPlaneSnapshot: unknown;
}) {
  return (
    row.kind !== "adopt-worker" &&
    row.kind !== "repair-trmnl" &&
    row.platformSnapshot === null &&
    row.controlPlaneSnapshot === null
  );
}

/** Kinds whose success moves the accepted selection (model V1); the rest only prove hosts or plans. */
export function advancesAcceptance(kind: string) {
  return !["adopt-worker", "repair-trmnl", "tofu-plan"].includes(kind);
}

/** Every target instance a deployment acts on, in canonical (sorted) order (model T1). */
export function targetInstances(
  pipeline: PipelineDefinition,
  application: string | null,
): string[] {
  switch (pipeline.kind) {
    case "static-site":
      return [`bucket:${pipeline.bucket}`];
    case "tofu":
      return [`stack:${pipeline.stack}`];
    case "control-plane":
      return [`application:${pipeline.application}`];
    case "root-release":
      return ["application:apps"];
    case "manual":
      return application === null ? [] : [`application:${application}`];
    case "argocd":
      return [
        `application:${pipeline.application}`,
        ...(pipeline.scoutSite === undefined
          ? []
          : [`bucket:${pipeline.scoutSite.bucket}`]),
        ...(pipeline.workerRollout === undefined
          ? []
          : [`worker-pool:${pipeline.workerRollout.target}`]),
      ].sort();
  }
}

export function leaseExpiry(leaseSeconds: number) {
  return new Date(Date.now() + leaseSeconds * 1000);
}

/**
 * A deployment is never owned by a different executor identity (D7). The
 * successor of a self-hosted handoff takes it only through `claimHandoff`
 * (D8); no ordinary claim or renewal transfers ownership.
 */
export function requireSameExecutor(
  row: { workflowId: string | null; workflowRunId: string | null },
  executor: ExecutorIdentity | undefined,
) {
  if (executor === undefined || row.workflowId === null) return;
  if (!sameExecutor(row, executor))
    throw new DeliveryError(
      "CONFLICT",
      "Deployment is owned by another executor identity; it is never re-owned",
    );
}

function sameExecutor(
  row: { workflowId: string | null; workflowRunId: string | null },
  executor: ExecutorIdentity,
) {
  return (
    row.workflowId === executor.workflowId &&
    row.workflowRunId === executor.workflowRunId
  );
}

/**
 * Only the executor that owns a deployment reports its result (D7). A
 * handed-off deployment awaits its successor's claim (D8), and once an
 * identity owns it, a finish naming none or another is refused, so a
 * delayed predecessor on the shared execute credential cannot settle it.
 */
export function requireFinishingExecutor(
  row: {
    workflowId: string | null;
    workflowRunId: string | null;
    handoffAt: Date | null;
  },
  executor: ExecutorIdentity | undefined,
) {
  if (row.handoffAt !== null)
    throw new DeliveryError(
      "CONFLICT",
      "A handed-off deployment finishes only after its successor executor claims it (D8)",
    );
  if (row.workflowId === null) return;
  if (
    executor?.workflowId !== row.workflowId ||
    executor.workflowRunId !== row.workflowRunId
  )
    throw new DeliveryError(
      "CONFLICT",
      "Only the executor that owns the deployment reports its result (D7)",
    );
}

/**
 * Who may write a stage of a running deployment (D7, D8). While a handoff
 * waits, no executor writes; the successor claims first. Before an identity
 * owns the deployment, its writes are the owner's. Once one does, a write
 * names that identity, or is a native Job's checkpoint: a running stage
 * re-recorded as running under its own operation id, which the Job's
 * spawning Activity already holds and which never renews the lease. Returns
 * whether the write is the owner's or such a checkpoint.
 */
export function stageWriter(
  row: {
    workflowId: string | null;
    workflowRunId: string | null;
    handoffAt: Date | null;
  },
  executor: ExecutorIdentity | undefined,
  write: {
    existing: { status: string; operationId: string } | null;
    status: string;
    operationId: string;
  },
): "owner" | "checkpoint" {
  if (row.handoffAt !== null)
    throw new DeliveryError(
      "CONFLICT",
      "A handed-off deployment records stages only after its successor executor claims it (D8)",
    );
  if (row.workflowId === null) return "owner";
  if (
    executor?.workflowId === row.workflowId &&
    executor.workflowRunId === row.workflowRunId
  )
    return "owner";
  if (
    executor === undefined &&
    write.status === "running" &&
    write.existing?.status === "running" &&
    write.existing.operationId === write.operationId
  )
    return "checkpoint";
  throw new DeliveryError(
    "CONFLICT",
    "Only the executor that owns the deployment records its stages (D7)",
  );
}

/** A request whose frozen binding generation moved can no longer be approved (H2). */
export async function expireApproval(tx: Transaction, deploymentId: string) {
  await tx.approval.updateMany({
    where: { deploymentId, status: { in: ["pending", "granted"] } },
    data: { status: "expired", decidedAt: new Date() },
  });
}

/**
 * D7: a running deployment whose lease lapsed is no longer provably owned.
 * No write may act on it or extend the lease; the lease scan ends it failed
 * and recovery-required.
 */
export function requireLiveLease(row: {
  status: string;
  leaseExpiresAt: Date | null;
}) {
  if (
    row.status === "running" &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt.getTime() <= Date.now()
  )
    throw new DeliveryError(
      "CONFLICT",
      "The deployment's lease lapsed; it is no longer provably owned and ends in recovery (D7)",
    );
}

/** Locks and reads a deployment that must still be running for this write. */
export async function runningDeployment(
  tx: Transaction,
  deploymentId: string,
  refusal: string,
) {
  await lock(tx, `deployment:${deploymentId}`);
  const row = required(
    await tx.deployment.findUnique({ where: { id: deploymentId } }),
    "Deployment",
  );
  if (row.status !== "running") throw new DeliveryError("CONFLICT", refusal);
  requireLiveLease(row);
  return row;
}

/** The owning executor renews its lease; a lapsed lease ends in recovery (model D7). */
export async function renewLease(
  this: Delivery,
  deploymentId: string,
  executor: ExecutorIdentity,
  actor: Principal,
) {
  const leaseSeconds = await this.policy.leaseSeconds();
  return this.database.$transaction(async (tx) => {
    const row = await runningDeployment(
      tx,
      deploymentId,
      "Only a running deployment holds a lease",
    );
    requireSameExecutor(row, executor);
    if (row.handoffAt !== null)
      throw new DeliveryError(
        "CONFLICT",
        "A handed-off deployment's lease stays frozen until its successor executor claims it (D8)",
      );
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: { ...executor, leaseExpiresAt: leaseExpiry(leaseSeconds) },
    });
    await audit(tx, actor, {
      action: "deployment.lease_renewed",
      entityId: deploymentId,
      requestId: id(),
      metadata: executor,
    });
    return DeploymentSchema.parse(wire(updated));
  });
}

/**
 * D8: after applying a self-hosted change the outgoing executor leaves the
 * deployment owned with a handoff marker and a frozen lease that does not
 * expire; its successor takes ownership by claiming it.
 */
export async function handOff(
  this: Delivery,
  deploymentId: string,
  executor: ExecutorIdentity,
  actor: Principal,
) {
  return this.database.$transaction(async (tx) => {
    const row = await runningDeployment(
      tx,
      deploymentId,
      "Only a running deployment can be handed to a successor executor",
    );
    requireSameExecutor(row, executor);
    const service = await tx.service.findUniqueOrThrow({
      where: { id: row.serviceId },
    });
    if (!service.selfHosted)
      throw new DeliveryError(
        "INVALID",
        "Only a self-hosted service's deployment is handed to a successor executor (D8)",
      );
    if (row.handoffAt !== null) return DeploymentSchema.parse(wire(row));
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: { handoffAt: new Date(), leaseExpiresAt: null },
    });
    await audit(tx, actor, {
      action: "deployment.handed_off",
      entityId: deploymentId,
      requestId: id(),
      metadata: executor,
    });
    return DeploymentSchema.parse(wire(updated));
  });
}

/**
 * D8: the successor executor claims the handoff marker before it continues.
 * Only the deployment's one successor Workflow may take it, only while the
 * marker is held, and it receives a fresh lease. Any other identity, or a
 * deployment without the marker, is refused: work is never re-owned by a
 * different executor identity (D7).
 */
export async function claimHandoff(
  this: Delivery,
  deploymentId: string,
  executor: ExecutorIdentity,
  actor: Principal,
) {
  const leaseSeconds = await this.policy.leaseSeconds();
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    const row = await runningDeployment(
      tx,
      deploymentId,
      "Only a running deployment can be claimed by a successor executor",
    );
    if (executor.workflowId !== deliverySuccessorWorkflowId(deploymentId))
      throw new DeliveryError(
        "CONFLICT",
        "Only the deployment's successor executor claims its handoff (D8)",
      );
    if (row.handoffAt === null) {
      // A successor retrying its own completed claim resumes (D7).
      if (sameExecutor(row, executor)) return DeploymentSchema.parse(wire(row));
      throw new DeliveryError(
        "CONFLICT",
        "Deployment holds no handoff marker; it is never re-owned by a different executor identity (D7)",
      );
    }
    const service = await tx.service.findUniqueOrThrow({
      where: { id: row.serviceId },
    });
    const owner = await tx.environment.findUniqueOrThrow({
      where: { id: row.environmentId },
      select: { activeDeploymentId: true },
    });
    if (!service.selfHosted || owner.activeDeploymentId !== deploymentId)
      throw new DeliveryError(
        "CONFLICT",
        "A handoff passes only a self-hosted deployment that still owns its environment (D8)",
      );
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        ...executor,
        handoffAt: null,
        leaseExpiresAt: leaseExpiry(leaseSeconds),
      },
    });
    await audit(tx, actor, {
      action: "deployment.handoff_claimed",
      entityId: deploymentId,
      requestId: id(),
      metadata: {
        outgoing: {
          workflowId: row.workflowId,
          workflowRunId: row.workflowRunId,
        },
        successor: executor,
      },
    });
    return DeploymentSchema.parse(wire(updated));
  });
}
