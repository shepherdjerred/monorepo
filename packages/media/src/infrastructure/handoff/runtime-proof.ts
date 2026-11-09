import type { Prisma } from "#generated/prisma/client.ts";
import {
  CanonicalMountEvidenceSchema,
  NativeStorageAuthoritySchema,
} from "#shared/canonical-storage.ts";
import { assertManagedStorageApprovals } from "./managed-storage-approval.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";

export type RuntimeProofDatabase = Pick<
  Prisma.TransactionClient,
  | "mediaRuntimeState"
  | "mediaStorageAuthority"
  | "legacyWriterLease"
  | "applicationEvent"
>;

export class RuntimeProofError extends Error {}

export function isManagedStorage(evidence: unknown): boolean {
  if (
    z.object({ kind: z.literal("canonical_storage") }).safeParse(evidence)
      .success
  )
    return true;
  if (
    !z.object({ kind: z.literal("native_restore") }).safeParse(evidence).success
  )
    return false;
  const restored = NativeStorageAuthoritySchema.safeParse(evidence);
  // Corrupt restored provenance must never silently acquire legacy authority.
  return (
    !restored.success ||
    restored.data.approvedRoots.some((root) => root.receipt.kind === "managed")
  );
}

/** New acquisitions need current storage, not retirement of unrelated applications. */
export async function readRuntimeProof(
  db: RuntimeProofDatabase,
  budget?: PublicationAuthorityReadBudget,
) {
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
  const approvedRoots = [];
  for (const root of roots) {
    const restored = NativeStorageAuthoritySchema.safeParse(root.evidence);
    if (restored.success) {
      approvedRoots.push(...restored.data.approvedRoots);
      const approved = restored.data.approvedRoots.find(
        (item) => item.rootPath === root.rootPath,
      );
      if (
        approved?.pvcUid !== root.pvcUid ||
        approved.volumeName !== root.volumeName ||
        approved.volumePath !== root.volumePath
      )
        throw new RuntimeProofError("Media restored storage identity changed");
    }
  }
  if (approvedRoots.length > 0) {
    await assertManagedStorageApprovals(db, approvedRoots, budget).catch(
      (error: unknown) => {
        if (error instanceof NativeArchiveScopeProtection) throw error;
        throw new RuntimeProofError(
          "Media restored storage owner approval changed",
        );
      },
    );
  }
  if (
    roots.length !== 2 ||
    roots.some((root) => {
      const restored = NativeStorageAuthoritySchema.safeParse(root.evidence);
      const parsed = CanonicalMountEvidenceSchema.safeParse(
        restored.success ? restored.data.mounts : root.evidence,
      );
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
