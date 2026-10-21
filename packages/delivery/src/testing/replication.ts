import { requiresReplication } from "#shared/artifact-contract.ts";
import type { ArtifactReplication } from "#shared/artifact-contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor } from "./seed.ts";

/** A synthetic R2 receipt for bytes whose sha256 is `digest`. */
export function testReplication(digest: string): ArtifactReplication {
  return {
    store: "r2",
    bucket: "homelab-backup",
    key: `delivery-artifacts/${digest.slice(7)}`,
    digest,
    replicatedAt: new Date().toISOString(),
  };
}

/** Records a receipt for every produced artifact PC1 would hold pending; retained references need none. */
export async function replicateProducedArtifacts(
  delivery: Delivery,
  buildId: string,
) {
  const produced = await delivery.database.artifact.findMany({
    where: { buildId },
    orderBy: { id: "asc" },
  });
  for (const artifact of produced) {
    if (!requiresReplication(artifact.uri) || artifact.replication !== null)
      continue;
    await delivery.recordReplication(
      {
        artifactId: artifact.id,
        replication: testReplication(artifact.digest),
      },
      testExecutor,
    );
  }
}
