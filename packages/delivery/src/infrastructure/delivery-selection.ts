import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import { lock, required, audit } from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import { id, environment, automaticTarget } from "./delivery-data.ts";

export async function reconcile(
  this: Delivery,
  enabledEnvironments: string[],
  actor: Principal,
) {
  const selected: string[] = [];
  for (const row of await this.database.environment.findMany({
    where: { automatic: true, id: { in: enabledEnvironments } },
  })) {
    if (row.activeDeploymentId !== null) continue;
    const last = await this.database.deployment.findFirst({
      where: { environmentId: row.id },
      orderBy: { createdAt: "desc" },
    });
    if (
      last !== null &&
      ["failed", "awaiting_approval", "running"].includes(last.status)
    )
      continue;
    const target = await automaticTarget(this.database, row);
    if (
      target === null ||
      target.id === row.acceptedVersionSetRevisionId ||
      target.revision <= row.automaticSuppressedThroughRevision
    )
      continue;
    if (await automaticSelectionBlocked.call(this, last, target.id, actor))
      continue;
    const deployment = await requestAutomatic.call(this, row, target.id, actor);
    if (deployment !== null) selected.push(deployment.id);
  }
  return { deployments: selected };
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
        include: { approvals: true },
      }),
      "Deployment",
    );
    await lock(tx, `environment:${row.environmentId}`);
    const env = await environment(tx, row.environmentId);
    if (
      row.status !== "queued" ||
      !row.automatic ||
      row.approvals.length > 0 ||
      env.approvalRequired ||
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
