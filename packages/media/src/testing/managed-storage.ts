import type { Database } from "#infrastructure/database.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";

/** Disposable canonical worker proof, preserving any physical fixture's mount identity. */
export async function grantTestManagedStorage(db: Database) {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const rows = await db.mediaStorageAuthority.findMany();
  const priorLease = await db.legacyWriterLease.findUnique({
    where: { id: "singleton" },
  });
  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 90_000);
  const mounts = ["/data/movies", "/data/tv"].map((root) => {
    const row = rows.find((item) => item.rootPath === root);
    return {
      deployment: "media-media-files",
      deploymentUid: "fixture-files",
      generation: 1,
      specDigest: "a".repeat(64),
      container: "media-files",
      root,
      mountPath: root,
      subPath: "",
      readOnly: false,
      pvcName: "fixture-library",
      pvcUid: row?.pvcUid ?? `fixture-${root}`,
      volumeName: row?.volumeName ?? "fixture-volume",
      volumePath: row?.volumePath ?? root,
      podName: "fixture-files",
      podUid: row?.workerPodUid ?? "synthetic-files-worker",
      podSpecDigest: "b".repeat(64),
      replicaSetUid: "fixture-rs",
    };
  });
  const evidence = CanonicalMountEvidenceSchema.parse({
    schemaVersion: 1,
    kind: "canonical_storage",
    namespace: "media",
    capturedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    mounts,
  });
  for (const mount of evidence.mounts) {
    const data = {
      recoveryEpoch: runtime.recoveryEpoch,
      pvcUid: mount.pvcUid,
      volumeName: mount.volumeName,
      volumePath: mount.volumePath,
      workerPodUid: mount.podUid,
      evidence,
      observedAt,
      expiresAt,
      revokedAt: null,
    };
    await db.mediaStorageAuthority.upsert({
      where: { rootPath: mount.root },
      create: { rootPath: mount.root, ...data },
      update: data,
    });
  }
  await db.legacyWriterLease.deleteMany();
  return async () => {
    await db.mediaStorageAuthority.deleteMany({
      where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    });
    for (const row of rows.filter(
      (item) =>
        item.rootPath === "/data/movies" || item.rootPath === "/data/tv",
    ))
      await db.mediaStorageAuthority.create({
        data: {
          ...row,
          evidence: z.record(z.string(), z.json()).parse(row.evidence),
        },
      });
    await db.legacyWriterLease.deleteMany();
    if (priorLease !== null)
      await db.legacyWriterLease.create({
        data: {
          ...priorLease,
          observation: z
            .record(z.string(), z.json())
            .parse(priorLease.observation),
        },
      });
  };
}
