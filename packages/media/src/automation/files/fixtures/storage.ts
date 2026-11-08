import type { Database } from "#infrastructure/database.ts";

/** A real initial handoff installs its own observed storage grant instead of synthetic bootstrap rows. */
export async function fixtureStorageAuthority(
  db: Database,
  library: string,
  initialHandoff = false,
) {
  if (initialHandoff) return;
  for (const kind of ["movies", "tv"]) {
    const observedAt = new Date();
    const evidence = {
      recoveryEpoch: 0,
      pvcUid: `synthetic-${kind}`,
      volumeName: `synthetic-${kind}`,
      volumePath: library,
      workerPodUid: "synthetic-files-worker",
      evidence: { source: "synthetic-file-fixture" },
      observedAt,
      expiresAt: new Date(observedAt.getTime() + 120_000),
      revokedAt: null,
    };
    await db.mediaStorageAuthority.upsert({
      where: { rootPath: `/data/${kind}` },
      create: { rootPath: `/data/${kind}`, ...evidence },
      update: {},
    });
  }
}
