import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  ArtifactReplicationSchema,
  REPLICATED_STORE_URI_PREFIXES,
  requiresReplication,
} from "#shared/artifact-contract.ts";
import {
  PendingReplicationSchema,
  RecordArtifactReplicationSchema,
} from "#shared/contract.ts";
import type { RecordArtifactReplication } from "#shared/artifact-contract.ts";
import type { Principal } from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
} from "#infrastructure/delivery-records.ts";
import {
  artifactView,
  id,
  type Transaction,
} from "#infrastructure/delivery-data.ts";

/** Produced bytes in a self-hosted store that have no off-cluster receipt yet (PC1). */
const UNREPLICATED = {
  replication: { equals: Prisma.DbNull },
  OR: REPLICATED_STORE_URI_PREFIXES.map((prefix) => ({
    uri: { startsWith: prefix },
  })),
} satisfies Prisma.ArtifactWhereInput;

/** True while an artifact this build produced awaits its replica; retained references never count. */
export async function replicationPending(
  tx: Transaction | Database,
  buildId: string,
) {
  return (await tx.artifact.count({ where: { buildId, ...UNREPLICATED } })) > 0;
}

export async function pendingReplication(this: Delivery, actor: Principal) {
  requireScope(actor, "execute");
  const rows = await this.database.artifact.findMany({
    where: { ...UNREPLICATED, build: { status: "pending" } },
    include: { build: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  return PendingReplicationSchema.parse({
    artifacts: rows.map((row) => ({
      artifactId: row.id,
      buildId: row.buildId,
      serviceId: row.build.serviceId,
      uri: row.uri,
      digest: row.digest,
    })),
  });
}

export async function recordReplication(
  this: Delivery,
  rawInput: RecordArtifactReplication,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = RecordArtifactReplicationSchema.parse(rawInput);
  return this.database.$transaction(async (tx) => {
    await lock(tx, `artifact-replication:${input.artifactId}`);
    const row = required(
      await tx.artifact.findUnique({
        where: { id: input.artifactId },
        include: { build: true },
      }),
      "Artifact",
    );
    if (!requiresReplication(row.uri))
      throw new DeliveryError(
        "INVALID",
        "Artifact bytes are not in a self-hosted store that requires replication",
      );
    if (input.replication.digest !== row.digest)
      throw new DeliveryError(
        "INVALID",
        "Replica digest differs from the artifact digest",
      );
    if (row.replication !== null) {
      // A receipt is immutable: the same copy replays, a different one conflicts.
      if (
        fingerprint(ArtifactReplicationSchema.parse(row.replication)) !==
        fingerprint(input.replication)
      )
        throw new DeliveryError(
          "CONFLICT",
          "A different replica receipt is already recorded for this artifact",
        );
      return artifactView(row);
    }
    const updated = await tx.artifact.update({
      where: { id: input.artifactId },
      data: { replication: input.replication },
      include: { build: true },
    });
    await audit(tx, actor, {
      action: "artifact.replicated",
      entityId: input.artifactId,
      requestId: id(),
      metadata: { ...input.replication },
    });
    return artifactView(updated);
  });
}
