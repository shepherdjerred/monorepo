import {
  IdentifierSchema,
  ArtifactVersionSchema,
  requiresReplication,
} from "@shepherdjerred/delivery/artifact-contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { createNarrowReader } from "@shepherdjerred/delivery/client";
import { replicateObject } from "@shepherdjerred/seaweedfs-backup/replicate";
import { storesFromEnvironment } from "@shepherdjerred/seaweedfs-backup/store";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

const Target = z
  .object({
    artifactId: IdentifierSchema,
    serviceId: IdentifierSchema,
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export function parseDeliveryReplicationTarget(raw: unknown) {
  return Target.parse(raw);
}

const BuildPage = z.object({
  items: z.array(
    z.object({
      id: IdentifierSchema,
      serviceId: IdentifierSchema,
      status: z.literal("pending"),
      artifacts: z.array(ArtifactVersionSchema),
    }),
  ),
  nextCursor: z.string().min(1).nullable(),
});

function pendingBuildArtifacts(
  build: z.infer<typeof BuildPage>["items"][number],
  serviceId: string,
) {
  if (build.serviceId !== serviceId)
    throw new Error("Delivery returned a foreign build");
  return build.artifacts.filter((artifact) => {
    if (artifact.buildId !== build.id || artifact.serviceId !== serviceId)
      throw new Error("Delivery returned a foreign artifact");
    return (
      artifact.replication === undefined && requiresReplication(artifact.uri)
    );
  });
}

/** Enumerate the service's pending builds rather than relying on the global 100-item queue. */
export async function pendingServiceArtifacts(
  read: ReturnType<typeof createNarrowReader>,
  serviceId: string,
) {
  IdentifierSchema.parse(serviceId);
  const artifacts: z.infer<typeof ArtifactVersionSchema>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ serviceId, status: "pending" });
    if (cursor !== undefined) query.set("cursor", cursor);
    const page = await read(`/builds?${query.toString()}`, BuildPage);
    for (const build of page.items)
      artifacts.push(...pendingBuildArtifacts(build, serviceId));
    if (page.nextCursor === null) return artifacts;
    if (seen.has(page.nextCursor))
      throw new Error("Delivery build pagination repeated a cursor");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

/** Copy and attest only the explicitly reviewed pending artifact. */
export async function replicateDeliveryArtifact(
  raw: unknown,
  client: Pick<DeliveryClient, "recordReplication"> & {
    pendingForService: (
      serviceId: string,
    ) => Promise<z.infer<typeof ArtifactVersionSchema>[]>;
  },
  copy: typeof replicateObject = replicateObject,
  stores?: ReturnType<typeof storesFromEnvironment>,
) {
  const target = parseDeliveryReplicationTarget(raw);
  const pending = await client.pendingForService(target.serviceId);
  const artifact = pending.find((entry) => entry.id === target.artifactId);
  if (
    artifact?.serviceId !== target.serviceId ||
    artifact.digest !== target.digest
  )
    throw new Error(
      "The exact artifact, service, and digest are not pending replication",
    );
  if (!requiresReplication(artifact.uri))
    throw new Error("Artifact is not in a replicated store");
  const match = /^s3:\/\/([^/]+)\/(.+)$/u.exec(artifact.uri);
  if (match?.[1] === undefined || match[2] === undefined)
    throw new Error("Invalid artifact URI");
  const selectedStores = stores ?? storesFromEnvironment();
  const replica = await copy({
    ...selectedStores,
    sourceBucket: match[1],
    sourceKey: match[2],
    expectedSha256: target.digest.slice(7),
  });
  if (replica.sha256 !== target.digest.slice(7))
    throw new Error("Replica digest differs from the reviewed target");
  const current = await client.pendingForService(target.serviceId);
  if (
    !current.some(
      (entry) =>
        entry.id === artifact.id &&
        entry.serviceId === artifact.serviceId &&
        entry.uri === artifact.uri &&
        entry.digest === artifact.digest,
    )
  )
    throw new Error(
      "Pending artifact changed during replication; inspect before retrying",
    );
  const replication = {
    store: "r2" as const,
    bucket: selectedStores.backupBucket,
    key: replica.backupObjectKey,
    digest: target.digest,
    replicatedAt: new Date().toISOString(),
  };
  const result = await client.recordReplication({
    artifactId: artifact.id,
    replication,
  });
  if (
    result.id !== target.artifactId ||
    result.digest !== target.digest ||
    !isDeepStrictEqual(result.replication, replication)
  )
    throw new Error("Delivery readback differs from the replicated artifact");
  return result;
}
