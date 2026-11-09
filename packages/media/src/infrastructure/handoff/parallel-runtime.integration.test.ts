import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import type { CanonicalMountEvidence } from "#shared/canonical-storage.ts";
import { refreshManagedStorage } from "./managed-storage.ts";
import { setManagedRuntime as activateRuntime } from "./parallel-runtime.ts";
import { runtimeAuthority } from "./authority.ts";
import { readRuntimeProof } from "./runtime-proof.ts";
import { refreshWriterLease } from "./lease.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const ownerId = crypto.randomUUID();
const setManagedRuntime = (
  tx: Parameters<typeof activateRuntime>[0],
  input: Parameters<typeof activateRuntime>[1],
) => activateRuntime(tx, input, ownerId);
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  await cluster.database.mediaUser.create({
    data: {
      id: ownerId,
      plexAccountId: ownerId,
      displayName: "Owner",
      role: "owner",
    },
  });
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await cluster.database.$executeRaw`TRUNCATE TABLE "ApplicationEvent" CASCADE`;
  await cluster.database.mediaStorageAuthority.deleteMany();
  await cluster.database.legacyWriterLease.deleteMany();
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: {
      mode: "observe",
      ownershipConfirmed: false,
      recoveryEpoch: 0,
      version: 0,
    },
  });
});

function mounts(
  podUid = "files-pod",
  pvcUid = "library-pvc",
): CanonicalMountEvidence {
  return {
    schemaVersion: 1,
    kind: "canonical_storage",
    namespace: "media",
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    mounts: (["/data/movies", "/data/tv"] as const).map((root) => ({
      deployment: "media-media-files",
      deploymentUid: "files-deployment",
      generation: 1,
      specDigest: "a".repeat(64),
      container: "media-files",
      root,
      mountPath: root,
      subPath: "",
      readOnly: false,
      pvcName: "library",
      pvcUid,
      volumeName: "library-volume",
      volumePath: root,
      podName: "files-pod",
      podUid,
      podSpecDigest: "b".repeat(64),
      replicaSetUid: "files-rs",
    })),
  };
}

test("fresh Media storage starts without legacy retirement and follows a replacement file pod", async () => {
  const db = cluster.database;
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts(),
  });
  await db.$transaction((tx) =>
    setManagedRuntime(tx, { mode: "active", expectedVersion: 0 }),
  );
  expect(await runtimeAuthority(db)).toEqual({ active: true, epoch: 0 });
  const now = new Date();
  await refreshWriterLease(db, async () => ({
    schemaVersion: 1,
    namespace: "media",
    capturedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90_000).toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    targetsDigest: snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments),
    inventoryDigest: "c".repeat(64),
    controllers: [],
    quiescent: false,
    blockers: [
      { kind: "Deployment", name: "media-radarr", code: "writer_running" },
    ],
  }));
  expect(await runtimeAuthority(db)).toEqual({ active: true, epoch: 0 });
  const legacy = await db.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  expect(legacy.revokedAt).not.toBeNull();
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts("replacement-pod"),
  });
  expect(await runtimeAuthority(db)).toEqual({ active: true, epoch: 0 });
  const refreshed = await db.mediaStorageAuthority.findFirstOrThrow();
  expect(refreshed.workerPodUid).toBe("replacement-pod");
  await db.$transaction((tx) =>
    setManagedRuntime(tx, { mode: "observe", expectedVersion: 1 }),
  );
  const paused = await runtimeAuthority(db);
  expect(paused.active).toBe(false);
});

test("missing, partial and expired canonical proof cannot activate or fall back to a legacy lease", async () => {
  const db = cluster.database;
  await expect(
    db.$transaction((tx) =>
      setManagedRuntime(tx, { mode: "active", expectedVersion: 0 }),
    ),
  ).rejects.toThrow("fresh observation");
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts(),
  });
  await db.mediaStorageAuthority.delete({ where: { rootPath: "/data/tv" } });
  await expect(readRuntimeProof(db)).rejects.toThrow("storage proof");
  await db.mediaStorageAuthority.deleteMany();
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts(),
  });
  await db.mediaStorageAuthority.updateMany({
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await expect(
    db.$transaction((tx) =>
      setManagedRuntime(tx, { mode: "active", expectedVersion: 0 }),
    ),
  ).rejects.toThrow("fresh observation");
});

test("durable managed storage approval requires an actual owner and permits repeated activation", async () => {
  const db = cluster.database;
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts(),
  });
  const member = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Member",
      role: "member",
    },
  });
  await expect(
    db.$transaction((tx) =>
      activateRuntime(tx, { mode: "active", expectedVersion: 0 }, member.id),
    ),
  ).rejects.toThrow("exact current owner activation");
  await db.$transaction((tx) =>
    setManagedRuntime(tx, { mode: "active", expectedVersion: 0 }),
  );
  await db.$transaction((tx) =>
    setManagedRuntime(tx, { mode: "active", expectedVersion: 1 }),
  );
  expect(
    await db.applicationEvent.count({
      where: { kind: "managed_storage_approval_v1" },
    }),
  ).toBe(2);
});

test("changed storage identity revokes active runtime instead of approving the replacement volume", async () => {
  const db = cluster.database;
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts(),
  });
  await db.$transaction((tx) =>
    setManagedRuntime(tx, { mode: "active", expectedVersion: 0 }),
  );
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts("files-pod", "different-pvc"),
  });
  const revoked = await runtimeAuthority(db);
  expect(revoked.active).toBe(false);
  const root = await db.mediaStorageAuthority.findFirstOrThrow();
  expect(root.pvcUid).toBe("library-pvc");
  expect(root.revokedAt).not.toBeNull();
});

test("same storage can be reattested after an observation outage and explicitly restarted", async () => {
  const db = cluster.database;
  const original = mounts();
  original.capturedAt = new Date(Date.now() - 5000).toISOString();
  original.expiresAt = new Date(
    Date.parse(original.capturedAt) + 90_000,
  ).toISOString();
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => original,
  });
  await db.$transaction((tx) =>
    setManagedRuntime(tx, { mode: "active", expectedVersion: 0 }),
  );
  await refreshManagedStorage(db, {
    observeCanonicalMounts: () =>
      Promise.reject(new Error("Observer temporarily unavailable")),
  });
  const revoked = await db.mediaStorageAuthority.findFirstOrThrow();
  expect(revoked.revokedAt).not.toBeNull();
  const fresh = mounts("replacement-pod");
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => fresh,
  });
  const restored = await db.mediaStorageAuthority.findFirstOrThrow();
  expect(restored.revokedAt).toBeNull();
  expect(restored.pvcUid).toBe(revoked.pvcUid);
  expect(restored.workerPodUid).toBe("replacement-pod");
  expect(restored.observedAt.toISOString()).toBe(fresh.capturedAt);
  expect(restored.expiresAt.toISOString()).toBe(fresh.expiresAt);
  expect(restored.observedAt.getTime()).toBeGreaterThan(
    revoked.observedAt.getTime(),
  );
  const paused = await runtimeAuthority(db);
  expect(paused.active).toBe(false);
  await db.$transaction((tx) =>
    setManagedRuntime(tx, { mode: "active", expectedVersion: 2 }),
  );
  expect(await runtimeAuthority(db)).toEqual({ active: true, epoch: 0 });
});
