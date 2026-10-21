import {
  ArtifactVersionSchema,
  PendingReplicationSchema,
  type ArtifactReplication,
  type PendingReplication,
} from "@shepherdjerred/delivery/artifact-contract";
import { deliveryRequest } from "#lib/delivery/client.ts";

/** Produced artifacts whose self-hosted bytes still lack an off-cluster replica. */
export async function listDeliveryReplications(): Promise<PendingReplication> {
  return await deliveryRequest("replication/pending", PendingReplicationSchema);
}

/**
 * Store a replica receipt on its artifact. The API refuses a digest that
 * differs from the artifact's own and accepts an identical repeat, so a lost
 * response is safe to retry on a later dispatch tick.
 */
export async function recordDeliveryReplication(input: {
  artifactId: string;
  replication: ArtifactReplication;
}): Promise<void> {
  await deliveryRequest("artifacts/replication", ArtifactVersionSchema, input);
}
