import type { Transaction } from "./delivery-data.ts";
import { DeliveryError } from "#domain/error.ts";
import { releaseTerminalOwnership } from "./terminal-ownership.ts";

/**
 * Settle quarantine without accepting a release or changing its failed
 * result. Settlement releases ownership only; the binding generation moves
 * on acceptance alone (model E1, I3).
 *
 * The settled deployment releases everything it holds, as finish does. A
 * content recovery's platform lock survives only as its journaled producer
 * barrier, which the independently observed producer restoration releases
 * (`restoredContentRecovery`).
 */
export async function settleRecoveryTarget(
  tx: Transaction,
  input: {
    deploymentId: string;
    environmentId: string;
    expectedGeneration: number;
  },
) {
  const owned = await tx.environment.count({
    where: {
      id: input.environmentId,
      activeDeploymentId: input.deploymentId,
      generation: input.expectedGeneration,
    },
  });
  if (owned !== 1)
    throw new DeliveryError(
      "CONFLICT",
      "Independent recovery lost its exact target owner or environment generation",
    );
  await tx.deployment.update({
    where: { id: input.deploymentId },
    data: { recoveryRequired: false },
  });
  await releaseTerminalOwnership(tx, input.deploymentId);
}
