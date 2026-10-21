import { DeliveryError } from "#domain/error.ts";
import { DeploymentSchema } from "#shared/contract.ts";
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
 * A deployment is never owned by a different executor identity (D7),
 * except the successor executor of a self-hosted handoff (D8). Returns
 * whether this claim is that successor taking ownership.
 */
export function requireSameExecutor(
  row: {
    workflowId: string | null;
    workflowRunId: string | null;
    handoffAt: Date | null;
  },
  executor: ExecutorIdentity | undefined,
) {
  if (executor === undefined || row.workflowId === null) return false;
  if (
    row.workflowId === executor.workflowId &&
    row.workflowRunId === executor.workflowRunId
  )
    return false;
  if (row.handoffAt !== null) return true;
  throw new DeliveryError(
    "CONFLICT",
    "Deployment is owned by another executor identity; it is never re-owned",
  );
}

/** A request whose frozen binding generation moved can no longer be approved (H2). */
export async function expireApproval(tx: Transaction, deploymentId: string) {
  await tx.approval.updateMany({
    where: { deploymentId, status: { in: ["pending", "granted"] } },
    data: { status: "expired", decidedAt: new Date() },
  });
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
