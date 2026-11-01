import type { Transaction } from "./delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";

/**
 * Release every lock a terminal deployment holds: its target instances and,
 * when it holds it, the shared-resources platform lock (T1). Finish, orphan
 * recovery and each independent recovery settlement share this, so a
 * deployment that is no longer recovery-required never keeps a lock a queued
 * deployment needs to claim. Only rows naming this deployment are deleted; a
 * lock another deployment holds is untouched.
 */
export async function releaseDeploymentLocks(
  tx: Transaction,
  deploymentId: string,
) {
  await tx.targetLock.deleteMany({ where: { deploymentId } });
  await tx.platformLock.deleteMany({ where: { deploymentId } });
}

/**
 * Settle quarantine without accepting a release or changing its failed
 * result. Settlement releases ownership only; the binding generation moves
 * on acceptance alone (model E1, I3).
 *
 * `releaseGlobal: false` is content recovery's alone: its platform lock is
 * the journaled global producer barrier taken while the shared content
 * producer is stopped, and only the independently observed producer
 * restoration releases it (`restoredContentRecovery`). Every other settlement
 * releases the platform lock with the target locks, as finish does.
 */
export async function settleRecoveryTarget(
  tx: Transaction,
  input: {
    deploymentId: string;
    environmentId: string;
    expectedGeneration: number;
    releaseGlobal: boolean;
  },
) {
  const changed = await tx.environment.updateMany({
    where: {
      id: input.environmentId,
      activeDeploymentId: input.deploymentId,
      generation: input.expectedGeneration,
    },
    data: { activeDeploymentId: null },
  });
  if (changed.count !== 1)
    throw new DeliveryError(
      "CONFLICT",
      "Independent recovery lost its exact target owner or environment generation",
    );
  await tx.deployment.update({
    where: { id: input.deploymentId },
    data: { recoveryRequired: false },
  });
  if (input.releaseGlobal) await releaseDeploymentLocks(tx, input.deploymentId);
  else
    await tx.targetLock.deleteMany({
      where: { deploymentId: input.deploymentId },
    });
}
