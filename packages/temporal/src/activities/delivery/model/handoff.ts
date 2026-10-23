import { z } from "zod";
import { DeploymentSchema } from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deploymentPath, executorIdentity } from "./stages.ts";

/**
 * D8: after applying a self-hosted deployment the outgoing executor leaves
 * it owned with a handoff marker and a frozen lease; it does not accept it.
 */
export async function handOffDelivery(id: string): Promise<void> {
  await deliveryRequest(
    `${deploymentPath(id)}/handoff`,
    DeploymentSchema,
    executorIdentity(),
  );
}

/**
 * D8: the successor executor claims the marker before anything else. The
 * API refuses any other identity and any deployment without the marker,
 * so the outgoing executor's work is never re-owned by another (D7).
 */
export async function claimDeliveryHandoff(id: string): Promise<void> {
  await deliveryRequest(
    `${deploymentPath(id)}/successor`,
    DeploymentSchema,
    executorIdentity(),
  );
}

/**
 * The successor could not verify the applied self-hosted change. Its effect
 * is ambiguous, so the deployment keeps its locks and the dispatch barrier
 * until a recovery intent settles it (D5, D8).
 */
export async function failDeliveryHandoff(id: string): Promise<void> {
  await deliveryRequest(`${deploymentPath(id)}/finish`, z.unknown(), {
    status: "failed",
    message:
      "Successor executor could not verify the handed-off self-hosted deployment; settle it through a recovery intent",
    recoveryRequired: true,
    evidence: [],
    // The successor owns the deployment now; only its identity reports (D7).
    executor: executorIdentity(),
  });
}
