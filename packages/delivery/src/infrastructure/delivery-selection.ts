import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema, type Principal } from "#shared/contract.ts";
import type { StoredRecipeDefinition } from "#shared/model/record-contract.ts";
import { lock, required, audit, wire } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import {
  id,
  environment,
  automaticTarget,
  type Transaction,
} from "./delivery-data.ts";
import { reconcilePlatform } from "./platform/selection.ts";
import { legacyPipelineOf } from "./execution/legacy-recipe.ts";
import {
  releaseStrandedOwnership,
  releaseTerminalOwnership,
} from "./terminal-ownership.ts";

/** Platform and control-plane pipelines reconcile through their own typed requests. */
function specializedPipeline(stored: StoredRecipeDefinition) {
  const kind = legacyPipelineOf(stored)?.kind;
  return kind === "root-release" || kind === "tofu" || kind === "control-plane";
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
  // A stored recipe of either generation (P1); a model recipe is no v1 pipeline.
  const { definition } = PipelineRevisionSchema.parse(
    wire(
      await this.database.pipeline.findUniqueOrThrow({
        where: { id: row.pipelineRevisionId },
      }),
    ),
  );
  if (specializedPipeline(definition)) return null;
  if (row.activeDeploymentId !== null) return null;
  // An alarmed selection holds the environment until the monitor's
  // rollback or an operator acts (W2, D2).
  if (await alarmedAndLatest(this.database, row)) return null;
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
    : requestAutomatic.call(
        this,
        row,
        { id: target.id, kind: automaticKind(definition.kind) },
        actor,
      );
}

/** A channel recipe is realised by `channel-publish` (4.12); every other by `deploy`. */
function automaticKind(recipeKind: string): "deploy" | "channel-publish" {
  return recipeKind === "channel" ? "channel-publish" : "deploy";
}

async function alarmedAndLatest(
  database: Delivery["database"],
  row: { id: string; acceptedDeploymentId: string | null },
) {
  if (row.acceptedDeploymentId === null) return false;
  const accepted = await database.deployment.findUniqueOrThrow({
    where: { id: row.acceptedDeploymentId },
  });
  if (accepted.monitorState !== "alarmed") return false;
  const newer = await database.deployment.count({
    where: { environmentId: row.id, createdAt: { gt: accepted.createdAt } },
  });
  return newer === 0;
}

/** W2: alarmed selections under `automatic` policy get their restoration rollback. */
async function restoreAlarmed(
  this: Delivery,
  enabledEnvironments: string[],
  actor: Principal,
) {
  const requested: string[] = [];
  for (const alarmed of await this.database.deployment.findMany({
    where: {
      monitorState: "alarmed",
      environmentId: { in: enabledEnvironments },
      acceptedBy: { some: {} },
    },
    select: { id: true },
  })) {
    const asked = await this.database.request.findUnique({
      where: { id: `monitor/${alarmed.id}/rollback` },
    });
    if (asked !== null) continue;
    try {
      const rollback = await this.requestMonitorRollback(alarmed.id, actor);
      if (rollback !== null) requested.push(rollback.id);
    } catch (error) {
      if (!(error instanceof DeliveryError) || error.code !== "CONFLICT")
        throw error;
    }
  }
  return requested;
}

/**
 * Environments that admit deployments: v2 admits by catalog lifecycle, not
 * by an enable-list flag (4.10). A retired or removed environment admits
 * nothing.
 */
export async function activeEnvironmentIds(
  database: Transaction | Delivery["database"],
) {
  const rows = await database.environment.findMany({
    where: { lifecycle: "active" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}

/** Refuses a deployment effect on an environment the catalog no longer keeps active. */
export async function requireAdmitting(
  database: Delivery["database"],
  environmentId: string,
) {
  const env = await database.environment.findUnique({
    where: { id: environmentId },
    select: { lifecycle: true },
  });
  if (env === null)
    throw new DeliveryError(
      "NOT_FOUND",
      `Environment ${environmentId} not found`,
    );
  if (env.lifecycle !== "active")
    throw new DeliveryError(
      "CONFLICT",
      `Environment ${environmentId} is ${env.lifecycle} and admits no deployment`,
    );
}

export async function reconcile(
  this: Delivery,
  enabledEnvironments: string[],
  actor: Principal,
) {
  const leasesExpired = await expireLeases.call(this, actor);
  // Before selection, so a queued deployment is not held back by ownership a
  // settled deployment never released.
  const ownershipReleased = await releaseStrandedOwnership(
    this.database,
    actor,
  );
  const selected: string[] = await restoreAlarmed.call(
    this,
    enabledEnvironments,
    actor,
  );
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
    ...(ownershipReleased.length === 0 ? {} : { ownershipReleased }),
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
    await releaseTerminalOwnership(tx, deploymentId);
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
  target: { id: string; kind: "deploy" | "channel-publish" },
  actor: Principal,
) {
  const targetId = target.id;
  // Automatic request identity keys on the environment's last terminal
  // deployment, not on the binding generation (D3).
  const lastTerminal = await this.database.deployment.findFirst({
    where: {
      environmentId: row.id,
      status: { in: ["succeeded", "failed", "canceled"] },
    },
    orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  const requestId = `automatic/${row.id}/${targetId}/${lastTerminal?.id ?? "initial"}`;
  try {
    return await this.createDeployment(
      row.promotionSourceEnvironmentId === null
        ? {
            requestId,
            environmentId: row.id,
            versionSetRevisionId: targetId,
            expectedGeneration: row.generation,
            kind: target.kind,
          }
        : {
            requestId,
            environmentId: row.id,
            expectedGeneration: row.generation,
            kind: "promote",
            sourceEnvironmentId: row.promotionSourceEnvironmentId,
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
