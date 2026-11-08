import type { Prisma } from "#generated/prisma/client.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";

export type RuntimeProofDatabase = Pick<
  Prisma.TransactionClient,
  "mediaRuntimeState" | "mediaStorageAuthority" | "legacyWriterLease"
>;

export class RuntimeProofError extends Error {}

export function isManagedStorage(evidence: unknown): boolean {
  return z.object({ kind: z.literal("canonical_storage") }).safeParse(evidence)
    .success;
}

/** New acquisitions need current storage, not retirement of unrelated applications. */
export async function readRuntimeProof(db: RuntimeProofDatabase) {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const roots = await db.mediaStorageAuthority.findMany({
    where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    orderBy: { rootPath: "asc" },
  });
  if (!roots.some((root) => isManagedStorage(root.evidence))) {
    const legacy = await db.legacyWriterLease.findUnique({
      where: { id: "singleton" },
    });
    if (legacy === null)
      throw new RuntimeProofError("Media runtime proof is missing");
    return { kind: "legacy_writer" as const, ...legacy };
  }
  const now = Date.now();
  if (
    roots.length !== 2 ||
    roots.some((root) => {
      const parsed = CanonicalMountEvidenceSchema.safeParse(root.evidence);
      if (!parsed.success) return true;
      const mount = parsed.data.mounts.find(
        (item) => item.root === root.rootPath,
      );
      return (
        root.recoveryEpoch !== runtime.recoveryEpoch ||
        root.revokedAt !== null ||
        root.observedAt.getTime() > now ||
        root.expiresAt.getTime() <= now ||
        root.expiresAt.getTime() - root.observedAt.getTime() > 120_000 ||
        parsed.data.configurationDigest !==
          snapshotHash(LEGACY_OBSERVER_CONFIG) ||
        Date.parse(parsed.data.capturedAt) !== root.observedAt.getTime() ||
        Date.parse(parsed.data.expiresAt) !== root.expiresAt.getTime() ||
        mount?.pvcUid !== root.pvcUid ||
        mount.volumeName !== root.volumeName ||
        mount.volumePath !== root.volumePath ||
        mount.podUid !== root.workerPodUid
      );
    }) ||
    new Set(roots.map((root) => root.workerPodUid)).size !== 1
  )
    throw new RuntimeProofError(
      "Media runtime storage proof is missing, changed or expired",
    );
  return {
    kind: "canonical_storage" as const,
    recoveryEpoch: runtime.recoveryEpoch,
    observedAt: new Date(
      Math.max(...roots.map((root) => root.observedAt.getTime())),
    ),
    expiresAt: new Date(
      Math.min(...roots.map((root) => root.expiresAt.getTime())),
    ),
    revokedAt: null,
  };
}
