import type { Transaction } from "./delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";

/**
 * Settle quarantine without accepting a release or changing its failed
 * result. Settlement releases ownership only; the binding generation moves
 * on acceptance alone (model E1, I3).
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
  await tx.targetLock.deleteMany({
    where: { deploymentId: input.deploymentId },
  });
  await tx.deployment.update({
    where: { id: input.deploymentId },
    data: { recoveryRequired: false },
  });
  if (input.releaseGlobal)
    await tx.platformLock.deleteMany({
      where: { deploymentId: input.deploymentId },
    });
}
