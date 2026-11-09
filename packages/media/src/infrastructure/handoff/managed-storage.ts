import { lockUnchangedRuntime } from "./authority.ts";
import type { Database } from "#infrastructure/database.ts";
import type { createLegacyObserver } from "#integrations/legacy-observer/runtime.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { refreshNativeStorageAuthorities } from "#infrastructure/native-recovery/storage-refresh.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { isManagedStorage } from "./runtime-proof.ts";
import { revokeObservedStorage } from "./storage.ts";
import { z } from "zod";

/** A fresh installation observes its own ready file worker, independently of old apps. */
export async function refreshManagedStorage(
  db: Database,
  observer: Pick<
    ReturnType<typeof createLegacyObserver>,
    "observeCanonicalMounts"
  >,
): Promise<boolean> {
  const before = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const rows = await db.mediaStorageAuthority.findMany({
    where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    orderBy: { rootPath: "asc" },
  });
  if (
    rows.some(
      (row) =>
        z.object({ kind: z.literal("native_restore") }).safeParse(row.evidence)
          .success,
    )
  ) {
    if (!rows.every((row) => isManagedStorage(row.evidence))) return false;
    await refreshNativeStorageAuthorities({ db, observer, before, rows });
    return true;
  }
  if (rows.length > 0 && !rows.some((row) => isManagedStorage(row.evidence)))
    return false;
  if ((await db.mediaHandoffReceipt.count()) !== 0) return false;
  if (
    rows.length === 0 &&
    (await db.libraryAsset.count({ where: { owned: true } })) !== 0
  )
    return false;
  let proof: ReturnType<typeof CanonicalMountEvidenceSchema.parse> | null =
    null;
  try {
    const observed = CanonicalMountEvidenceSchema.parse(
      await observer.observeCanonicalMounts(),
    );
    const now = Date.now();
    if (
      Date.parse(observed.capturedAt) <= now &&
      Date.parse(observed.expiresAt) > now &&
      Date.parse(observed.expiresAt) - Date.parse(observed.capturedAt) <=
        120_000 &&
      observed.configurationDigest === snapshotHash(LEGACY_OBSERVER_CONFIG)
    )
      proof = observed;
  } catch {
    /* Unavailable observations revoke permission, never invent storage identity. */
  }
  await db.$transaction(async (tx) => {
    const runtime = await lockUnchangedRuntime(tx, before);
    if (runtime === null) return;
    const current = await tx.mediaStorageAuthority.findMany({
      where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    });
    if (
      current.length !== rows.length ||
      current.some(
        (row) =>
          !rows.some(
            (prior) =>
              prior.rootPath === row.rootPath && prior.version === row.version,
          ),
      )
    )
      return;
    if (
      proof === null ||
      current.some((row) => {
        const mount = proof.mounts.find((item) => item.root === row.rootPath);
        return (
          !isManagedStorage(row.evidence) ||
          row.recoveryEpoch !== runtime.recoveryEpoch ||
          mount?.pvcUid !== row.pvcUid ||
          mount.volumeName !== row.volumeName ||
          mount.volumePath !== row.volumePath
        );
      })
    ) {
      if (current.length === 0) return;
      await revokeObservedStorage(tx, {
        where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
        revokeRuntime: runtime.mode === "active",
        evidenceDigest: snapshotHash(proof),
      });
      return;
    }
    for (const mount of proof.mounts) {
      // A fresh observation can reattest the same storage after an outage.
      // Revocation leaves the runtime paused until the owner starts it again.
      const data = {
        recoveryEpoch: runtime.recoveryEpoch,
        pvcUid: mount.pvcUid,
        volumeName: mount.volumeName,
        volumePath: mount.volumePath,
        workerPodUid: mount.podUid,
        evidence: proof,
        observedAt: new Date(proof.capturedAt),
        expiresAt: new Date(proof.expiresAt),
        revokedAt: null,
      };
      await tx.mediaStorageAuthority.upsert({
        where: { rootPath: mount.root },
        create: { rootPath: mount.root, ...data },
        update: { ...data, version: { increment: 1 } },
      });
    }
  });
  return true;
}
