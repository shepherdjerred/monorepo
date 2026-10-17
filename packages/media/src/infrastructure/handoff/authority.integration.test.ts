import { beforeAll, afterAll, test, expect } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestLease } from "#testing/authority.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { runtimeAuthority, recordsAuthorized } from "./authority.ts";
import { refreshWriterLease } from "./lease.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import { requireStorageAuthority } from "./storage.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

function observation(quiescent: boolean): QuiescenceEvidence {
  return {
    schemaVersion: 1,
    namespace: "media",
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    targetsDigest: snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments),
    inventoryDigest: "a".repeat(64),
    quiescent,
    blockers: quiescent
      ? []
      : [{ code: "writer_running", kind: "Deployment", name: "media-radarr" }],
    controllers: LEGACY_OBSERVER_CONFIG.legacyDeployments.map((name) => ({
      kind: "Deployment",
      name,
      uid: name,
      generation: 1,
      resourceVersion: "1",
      specDigest: "b".repeat(64),
      observedGeneration: 1,
      desired: quiescent ? 0 : 1,
      current: quiescent ? 0 : 1,
      ready: quiescent ? 0 : 1,
    })),
  };
}

test("fresh observation revokes active mode when a writer resumes; later stopped writers cannot reactivate it", async () => {
  const db = cluster.database;
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 4 },
  });
  await refreshWriterLease(db, async () => observation(true));
  expect(await runtimeAuthority(db)).toEqual({ active: true, epoch: 4 });
  await refreshWriterLease(db, async () => observation(false));
  expect(await runtimeAuthority(db)).toEqual({ active: false, epoch: 4 });
  await refreshWriterLease(db, async () => observation(true));
  expect(await runtimeAuthority(db)).toEqual({ active: false, epoch: 4 });
});

test("expired or old-epoch leases fail closed", async () => {
  const db = cluster.database;
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 5 },
  });
  await grantTestLease(db, 4);
  const stale = await runtimeAuthority(db);
  expect(stale.active).toBe(false);
  await grantTestLease(db, 5);
  await db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: {
      observedAt: new Date(Date.now() - 90_001),
      expiresAt: new Date(Date.now() - 1),
    },
  });
  const expired = await runtimeAuthority(db);
  expect(expired.active).toBe(false);
});

test("file effect authority binds its actual executor and expiring selected root identity", async () => {
  const db = cluster.database;
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 5 },
  });
  await grantTestLease(db, 5);
  const rootPath = `/fixture/${crypto.randomUUID()}`;
  await db.mediaStorageAuthority.create({
    data: {
      rootPath,
      recoveryEpoch: 5,
      pvcUid: "selected-pvc",
      volumeName: "selected-volume",
      volumePath: "movies",
      workerPodUid: "current-pod",
      evidence: {},
      observedAt: new Date(),
      expiresAt: new Date(Date.now() + 90_000),
    },
  });
  await expect(
    requireStorageAuthority(db, rootPath, "current-pod"),
  ).resolves.toBeUndefined();
  await expect(
    requireStorageAuthority(db, rootPath, "old-rollout-pod"),
  ).rejects.toThrow("storage authority");
  await db.mediaStorageAuthority.update({
    where: { rootPath },
    data: { revokedAt: new Date() },
  });
  await expect(
    requireStorageAuthority(db, rootPath, "current-pod"),
  ).rejects.toThrow("storage authority");
});

test("Keep and pin preserve stale intent authority and system recovery hold; explicit Retry cannot authorize stale assets", async () => {
  const db = cluster.database;
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 6 },
  });
  await grantTestLease(db, 6);
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  const media = await db.mediaItem.create({
    data: {
      title: "Restored movie",
      kind: "movie",
      intent: { create: { automationEpoch: 5 } },
      requests: { create: { userId: user.id } },
      recoveryHold: {
        create: {
          recoveryEpoch: 6,
          reason: "recovery_request_history_unconfirmed",
        },
      },
    },
  });
  const asset = await db.libraryAsset.create({
    data: {
      path: `/fixture/${crypto.randomUUID()}`,
      state: "published",
      owned: true,
      ownershipEpoch: 5,
      sizeBytes: 10,
      properties: {},
      coverage: { create: { mediaId: media.id, current: true } },
    },
  });
  const commands = new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
  for (const [version, action] of (
    ["keep", "pin", "unpin"] as const
  ).entries()) {
    await commands.act(user, crypto.randomUUID(), media.id, {
      action,
      expectedVersion: version,
    });
    const protectedIntent = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId: media.id },
    });
    const hold = await db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: media.id },
    });
    expect(protectedIntent.automationEpoch).toBe(5);
    expect(hold.releasedAt).toBeNull();
  }
  await commands.act(user, crypto.randomUUID(), media.id, {
    action: "retry",
    expectedVersion: 3,
  });
  const renewed = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId: media.id },
  });
  expect(renewed.automationEpoch).toBe(6);
  expect(
    await recordsAuthorized(db, {
      epoch: 6,
      mediaIds: [media.id],
      assetIds: [asset.id],
    }),
  ).toBe(false);
});
