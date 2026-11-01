import { Prisma } from "#generated/prisma/client.ts";
import type { Principal } from "#shared/contract.ts";
import type { Database } from "./database.ts";
import { type Transaction, id, terminal } from "./delivery-data.ts";
import { audit, lock } from "./delivery-records.ts";

/** The three kinds of ownership a deployment can hold (T1, D7, D8). */
export const OWNERSHIP_KINDS = [
  "target_lock",
  "platform_lock",
  "active_deployment",
] as const;
export type OwnershipKind = (typeof OWNERSHIP_KINDS)[number];

/** The audit action of one release the reconciliation sweep had to make. */
export const STALE_OWNERSHIP_RELEASED = "deployment.stale_ownership_released";

type Released = {
  kind: OwnershipKind;
  /** The target instance, `platform`, or the environment id. */
  name: string;
};

/**
 * A journaled content producer barrier is ownership of its recovery intent,
 * not of the settled deployment: the platform lock stays until the observed
 * producer restoration releases it (`restoredContentRecovery`).
 */
async function holdsProducerBarrier(tx: Transaction, deploymentId: string) {
  return (
    (await tx.recoveryIntent.count({
      where: {
        deploymentId,
        barrier: { not: Prisma.DbNull },
        barrierRestoredAt: null,
      },
    })) !== 0
  );
}

/**
 * A terminal deployment that is not recovery-required holds nothing (T1, D5,
 * I1): release every target lock it holds, the platform lock when it holds
 * it, and every environment's active pointer that still names it. Finish,
 * orphan recovery, cancellation, rejection and every recovery settlement call
 * this in the transaction that makes the deployment terminal or clears
 * `recoveryRequired`, after recording that state. Only rows naming this
 * deployment change; a lock another deployment holds is untouched.
 *
 * The one retained row is a content recovery's journaled producer barrier,
 * which belongs to its recovery intent until the producer is restored.
 *
 * Calling it for a running or recovery-required deployment is a broken
 * internal contract and throws.
 */
export async function releaseTerminalOwnership(
  tx: Transaction,
  deploymentId: string,
): Promise<Released[]> {
  const row = await tx.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
    select: { status: true, recoveryRequired: true },
  });
  if (!terminal.has(row.status) || row.recoveryRequired)
    throw new Error(
      `Deployment ${deploymentId} is ${row.status}${row.recoveryRequired ? " and recovery-required" : ""}; only a settled terminal deployment releases its ownership`,
    );
  const released: Released[] = [];
  const targets = await tx.targetLock.findMany({
    where: { deploymentId },
    select: { instance: true },
    orderBy: { instance: "asc" },
  });
  if (targets.length > 0) {
    await tx.targetLock.deleteMany({ where: { deploymentId } });
    for (const target of targets)
      released.push({ kind: "target_lock", name: target.instance });
  }
  const platform = await tx.platformLock.findUnique({
    where: { deploymentId },
  });
  if (platform !== null && !(await holdsProducerBarrier(tx, deploymentId))) {
    await tx.platformLock.delete({ where: { deploymentId } });
    released.push({ kind: "platform_lock", name: platform.id });
  }
  const environments = await tx.environment.findMany({
    where: { activeDeploymentId: deploymentId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (environments.length > 0) {
    await tx.environment.updateMany({
      where: { activeDeploymentId: deploymentId },
      data: { activeDeploymentId: null },
    });
    for (const environment of environments)
      released.push({ kind: "active_deployment", name: environment.id });
  }
  return released;
}

/** Settled terminal deployments that still hold a lock or an active pointer. */
async function strandedHolders(database: Database) {
  const settled = {
    status: { in: [...terminal] },
    recoveryRequired: false,
  };
  const [targets, platform, pointers] = await Promise.all([
    database.targetLock.findMany({
      where: { deployment: settled },
      select: { deploymentId: true },
    }),
    database.platformLock.findMany({
      where: { deployment: settled },
      select: { deploymentId: true },
    }),
    database.environment.findMany({
      where: { activeDeploymentId: { not: null } },
      select: { activeDeploymentId: true },
    }),
  ]);
  const pointed = await database.deployment.findMany({
    where: {
      ...settled,
      id: {
        in: pointers.flatMap((row) =>
          row.activeDeploymentId === null ? [] : [row.activeDeploymentId],
        ),
      },
    },
    select: { id: true },
  });
  return [
    ...new Set([
      ...targets.map((row) => row.deploymentId),
      ...platform.map((row) => row.deploymentId),
      ...pointed.map((row) => row.id),
    ]),
  ].toSorted();
}

/**
 * The dispatch tick's reconciliation of the invariant above. Every release
 * here is a path that made a deployment terminal or settled it without
 * releasing its ownership, so each one is audited and counted
 * (`delivery_stale_ownership_released_total`), and alerts. A running or
 * recovery-required deployment is never touched: it is rechecked under its
 * deployment lock before anything is released.
 */
export async function releaseStrandedOwnership(
  database: Database,
  actor: Principal,
) {
  const released: {
    deploymentId: string;
    kind: OwnershipKind;
    name: string;
  }[] = [];
  for (const deploymentId of await strandedHolders(database)) {
    const rows = await database.$transaction(async (tx) => {
      await lock(tx, "delivery:claim");
      await lock(tx, `deployment:${deploymentId}`);
      const row = await tx.deployment.findUniqueOrThrow({
        where: { id: deploymentId },
        select: { status: true, recoveryRequired: true },
      });
      if (!terminal.has(row.status) || row.recoveryRequired) return [];
      const freed = await releaseTerminalOwnership(tx, deploymentId);
      for (const item of freed)
        await audit(tx, actor, {
          action: STALE_OWNERSHIP_RELEASED,
          entityId: deploymentId,
          requestId: id(),
          metadata: {
            kind: item.kind,
            name: item.name,
            status: row.status,
          },
        });
      return freed;
    });
    for (const item of rows) released.push({ deploymentId, ...item });
  }
  return released;
}
