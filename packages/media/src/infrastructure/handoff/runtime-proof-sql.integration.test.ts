import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { readRuntimeProof } from "./runtime-proof.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await cluster.database.mediaStorageAuthority.deleteMany();
  await cluster.database.legacyWriterLease.deleteMany();
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 7 },
  });
});

async function storage() {
  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 90_000);
  const mounts = ["/data/movies", "/data/tv"].map((root) => ({
    deployment: "media-media-files",
    deploymentUid: "files-deployment",
    generation: 1,
    specDigest: "a".repeat(64),
    container: "media-files",
    root,
    mountPath: root,
    subPath: "",
    readOnly: false,
    pvcName: root === "/data/movies" ? "movies" : "tv",
    pvcUid: `pvc-${root}`,
    volumeName: root === "/data/movies" ? "movies" : "tv",
    volumePath: "",
    podName: "files-pod",
    podUid: "files-pod-uid",
    podSpecDigest: "b".repeat(64),
    replicaSetUid: "files-rs",
  }));
  const evidence = CanonicalMountEvidenceSchema.parse({
    schemaVersion: 1,
    kind: "canonical_storage",
    namespace: "media",
    capturedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    mounts,
  });
  for (const mount of evidence.mounts)
    await cluster.database.mediaStorageAuthority.create({
      data: {
        rootPath: mount.root,
        recoveryEpoch: 7,
        pvcUid: mount.pvcUid,
        volumeName: mount.volumeName,
        volumePath: mount.volumePath,
        workerPodUid: mount.podUid,
        evidence,
        observedAt,
        expiresAt,
      },
    });
  return { observedAt, expiresAt };
}

const proof = () =>
  cluster.database.$queryRaw`
    SELECT * FROM media_runtime_proof_v1()
  `;

test("canonical storage authorizes new work without a legacy writer lease", async () => {
  const times = await storage();
  expect(await proof()).toEqual([
    { id: "singleton", recoveryEpoch: 7, revokedAt: null, ...times },
  ]);
  expect(await cluster.database.legacyWriterLease.count()).toBe(0);
});

test("a legacy lease cannot hide a missing or changed canonical root", async () => {
  await storage();
  await grantTestLease(cluster.database, 7);
  await cluster.database.mediaStorageAuthority.delete({
    where: { rootPath: "/data/tv" },
  });
  await expect(proof()).rejects.toThrow("both canonical storage roots");
});

test("SQL canonical proof uses the same repository configuration digest as TypeScript", async () => {
  const definitions = await cluster.database.$queryRaw<
    { definition: string }[]
  >`
    SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    WHERE p.proname='media_runtime_proof_v1'
  `;
  expect(definitions).toHaveLength(1);
  expect(definitions[0]?.definition).toContain(
    `v_evidence->>'configurationDigest'='${snapshotHash(LEGACY_OBSERVER_CONFIG)}'`,
  );
});

test("a changed canonical configuration digest is rejected by SQL and TypeScript despite a fresh legacy lease", async () => {
  await storage();
  await grantTestLease(cluster.database, 7);
  const roots = await cluster.database.mediaStorageAuthority.findMany();
  for (const root of roots)
    await cluster.database.mediaStorageAuthority.update({
      where: { rootPath: root.rootPath },
      data: {
        evidence: {
          ...CanonicalMountEvidenceSchema.parse(root.evidence),
          configurationDigest: "f".repeat(64),
        },
      },
    });
  await expect(proof()).rejects.toThrow("storage proof");
  await expect(readRuntimeProof(cluster.database)).rejects.toThrow(
    "storage proof",
  );
});

test.each(["revoked", "epoch", "expired", "identity", "worker"])(
  "canonical proof fails closed after %s changes",
  async (change) => {
    await storage();
    await grantTestLease(cluster.database, 7);
    await cluster.database.mediaStorageAuthority.update({
      where: { rootPath: "/data/tv" },
      data:
        change === "revoked"
          ? { revokedAt: new Date() }
          : change === "epoch"
            ? { recoveryEpoch: 6 }
            : change === "expired"
              ? {
                  observedAt: new Date(Date.now() - 90_000),
                  expiresAt: new Date(Date.now() - 1),
                }
              : change === "identity"
                ? { pvcUid: "different-pvc" }
                : { workerPodUid: "different-worker" },
    });
    await expect(proof()).rejects.toThrow();
  },
);

test("pause revokes canonical authorization", async () => {
  await storage();
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe" },
  });
  await expect(proof()).rejects.toThrow("not active");
});

test("adopted runtimes still need their fresh legacy writer proof", async () => {
  await expect(proof()).rejects.toThrow("writer proof");
  await grantTestLease(cluster.database, 7);
  expect(await proof()).toEqual([
    expect.objectContaining({ recoveryEpoch: 7, revokedAt: null }),
  ]);
  await cluster.database.legacyWriterLease.update({
    where: { id: "singleton" },
    data: { revokedAt: new Date() },
  });
  await expect(proof()).rejects.toThrow("writer proof");
});

test("legacy history and native recovery guards retain their writer requirement", async () => {
  const definitions = await cluster.database.$queryRaw<
    { definition: string }[]
  >`
    SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    WHERE p.proname IN ('media_movie_history_scope_current_v3',
      'media_series_pack_native_live_v1', 'media_series_pack_native_retry_v1')
  `;
  expect(definitions).toHaveLength(3);
  for (const { definition } of definitions) {
    expect(definition).toContain('FROM "LegacyWriterLease"');
    expect(definition).not.toContain("media_runtime_proof_v1()");
  }
});
