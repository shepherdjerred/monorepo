import { DeliveryError } from "#domain/error.ts";
import { PipelineDefinitionSchema, type Principal } from "#shared/contract.ts";
import { lock, required, audit } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { id, environment, automaticTarget } from "./delivery-data.ts";
import { reconcilePlatform } from "./platform/selection.ts";

/** Platform and control-plane pipelines reconcile through their own typed requests. */
function specializedPipeline(raw: unknown) {
  const definition = PipelineDefinitionSchema.parse(raw);
  return (
    definition.kind === "root-release" ||
    definition.kind === "tofu" ||
    definition.kind === "control-plane"
  );
}

type EnvironmentRow = Awaited<
  ReturnType<Delivery["database"]["environment"]["findMany"]>
>[number];

/** The automatic deployment one environment should receive now, if any (D2, D3, E0). */
async function reconcileEnvironment(
  this: Delivery,
  row: EnvironmentRow,
  actor: Principal,
) {
  const pipeline = await this.database.pipeline.findUniqueOrThrow({
    where: { id: row.pipelineRevisionId },
  });
  if (specializedPipeline(pipeline.definition)) return null;
  if (row.activeDeploymentId !== null) return null;
  const last = await this.database.deployment.findFirst({
    where: {
      environmentId: row.id,
      OR: [
        { kind: { notIn: ["adopt-worker", "repair-trmnl"] } },
        { status: { in: ["queued", "awaiting_approval", "running"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (
    last !== null &&
    ["failed", "awaiting_approval", "running"].includes(last.status)
  )
    return null;
  const target = await automaticTarget(this.database, row);
  if (
    target === null ||
    target.id === row.acceptedVersionSetRevisionId ||
    target.revision <= row.automaticSuppressedThroughRevision
  )
    return null;
  return (await automaticSelectionBlocked.call(this, last, target.id, actor))
    ? null
    : requestAutomatic.call(this, row, target.id, actor);
}

export async function reconcile(
  this: Delivery,
  enabledEnvironments: string[],
  actor: Principal,
) {
  const leasesExpired = await expireLeases.call(this, actor);
  const selected: string[] = [];
  for (const row of await this.database.environment.findMany({
    where: { automatic: true, id: { in: enabledEnvironments } },
  })) {
    const deployment = await reconcileEnvironment.call(this, row, actor);
    if (deployment !== null) selected.push(deployment.id);
  }
  const platform = await reconcilePlatform.call(
    this,
    enabledEnvironments,
    actor,
  );
  return {
    deployments: [...selected, ...platform.deployments],
    ...(platform.waiting.length === 0 ? {} : { waiting: platform.waiting }),
    ...(leasesExpired.length === 0 ? {} : { leasesExpired }),
  };
}

/**
 * A running deployment whose lease lapsed without renewal is no longer
 * provably owned; it ends recovery-required with its locks retained (D7).
 */
export async function expireLeases(this: Delivery, actor: Principal) {
  const candidates = await this.database.deployment.findMany({
    where: { status: "running", leaseExpiresAt: { lt: new Date() } },
    select: { id: true },
  });
  const expired: string[] = [];
  for (const candidate of candidates) {
    const changed = await this.database.$transaction(async (tx) => {
      await lock(tx, "delivery:claim");
      await lock(tx, `deployment:${candidate.id}`);
      const row = await tx.deployment.findUnique({
        where: { id: candidate.id },
      });
      if (
        row?.status !== "running" ||
        row.leaseExpiresAt === null ||
        row.leaseExpiresAt.getTime() >= Date.now()
      )
        return false;
      await tx.deployment.update({
        where: { id: row.id },
        data: {
          status: "failed",
          recoveryRequired: true,
          message:
            "Executor lease expired without renewal; inspect the target independently before releasing ownership",
          finishedAt: new Date(),
        },
      });
      await tx.outbox.deleteMany({ where: { deploymentId: row.id } });
      await audit(tx, actor, {
        action: "deployment.lease_expired",
        entityId: row.id,
        requestId: id(),
        metadata: {
          workflowId: row.workflowId,
          leaseExpiresAt: row.leaseExpiresAt.toISOString(),
        },
      });
      return true;
    });
    if (changed) expired.push(candidate.id);
  }
  return expired;
}

export async function automaticSelectionBlocked(
  this: Delivery,
  last: { id: string; status: string; versionSetRevisionId: string } | null,
  targetId: string,
  actor: Principal,
) {
  if (last === null) return false;
  switch (last.status) {
    case "canceled":
      return last.versionSetRevisionId === targetId;
    case "queued":
      return (
        last.versionSetRevisionId === targetId ||
        !(await supersedeQueuedAutomatic.call(this, last.id, targetId, actor))
      );
    default:
      return false;
  }
}

export async function supersedeQueuedAutomatic(
  this: Delivery,
  deploymentId: string,
  targetId: string,
  actor: Principal,
) {
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({
        where: { id: deploymentId },
        include: { approval: true },
      }),
      "Deployment",
    );
    await lock(tx, `environment:${row.environmentId}`);
    const env = await environment(tx, row.environmentId);
    // Only queued, unapproved automatic requests coalesce (model D3).
    if (
      row.status !== "queued" ||
      !row.automatic ||
      (row.approval !== null && row.approval.status !== "pending") ||
      env.activeDeploymentId !== null
    )
      return false;
    await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: "canceled",
        cancelRequested: true,
        finishedAt: new Date(),
        message: `Superseded before execution by version set ${targetId}`,
      },
    });
    await tx.outbox.deleteMany({ where: { deploymentId } });
    await audit(tx, actor, {
      action: "deployment.superseded",
      entityId: deploymentId,
      requestId: id(),
      metadata: { targetId },
    });
    return true;
  });
}

export async function requestAutomatic(
  this: Delivery,
  row: {
    id: string;
    generation: number;
    promotionSourceEnvironmentId: string | null;
  },
  targetId: string,
  actor: Principal,
) {
  try {
    return await this.createDeployment(
      {
        requestId: `automatic/${row.id}/${targetId}/${String(row.generation)}`,
        environmentId: row.id,
        versionSetRevisionId: targetId,
        expectedGeneration: row.generation,
        kind: row.promotionSourceEnvironmentId === null ? "deploy" : "promote",
        ...(row.promotionSourceEnvironmentId === null
          ? {}
          : { sourceEnvironmentId: row.promotionSourceEnvironmentId }),
      },
      actor,
      true,
    );
  } catch (error) {
    if (error instanceof DeliveryError && error.code === "CONFLICT")
      return null;
    throw error;
  }
}
