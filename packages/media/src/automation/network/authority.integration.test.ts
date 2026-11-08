import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { grantTestManagedStorage } from "#testing/managed-storage.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";
import {
  commandAutomationEpoch,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { assertLatestLease } from "#automation/handoff/final-guards.ts";
import { refreshMediaRuntimeAuthorities } from "#automation/network.ts";

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
    data: {
      mode: "active",
      ownershipConfirmed: true,
      recoveryEpoch: 0,
      version: 0,
    },
  });
  await grantTestManagedStorage(cluster.database);
});

function stoppedWriters(): QuiescenceEvidence {
  const now = Date.now();
  return {
    schemaVersion: 1,
    namespace: "media",
    capturedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 89_000).toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    targetsDigest: snapshotHash(LEGACY_OBSERVER_CONFIG.legacyDeployments),
    inventoryDigest: "a".repeat(64),
    quiescent: true,
    blockers: [],
    controllers: LEGACY_OBSERVER_CONFIG.legacyDeployments.map((name) => ({
      kind: "Deployment",
      name,
      uid: name,
      generation: 1,
      resourceVersion: "1",
      specDigest: "b".repeat(64),
      observedGeneration: 1,
      desired: 0,
      current: 0,
      ready: 0,
    })),
  };
}

async function observer(observe: () => Promise<QuiescenceEvidence>) {
  const row = await cluster.database.mediaStorageAuthority.findFirstOrThrow();
  const proof = CanonicalMountEvidenceSchema.parse(row.evidence);
  return {
    observe,
    observeCanonicalMounts: () => Promise.resolve(proof),
    observeMountBindings: () =>
      Promise.reject(
        new Error("Managed roots must not use legacy mount aliases"),
      ),
  };
}

test("managed refresh records resumed legacy writers and rejects the previously reviewed handoff", async () => {
  const db = cluster.database;
  const stopped = stoppedWriters();
  await refreshWriterLease(db, async () => stopped);
  await expect(
    db.$transaction((tx) =>
      assertLatestLease(tx, { quiescence: stopped, recoveryEpoch: 0 }),
    ),
  ).resolves.toBeUndefined();
  const running = {
    ...stopped,
    capturedAt: new Date().toISOString(),
    quiescent: false,
    blockers: [
      { code: "writer_running", kind: "Deployment", name: "media-radarr" },
    ],
    controllers: stopped.controllers.map((controller) => ({
      ...controller,
      desired: 1,
      current: 1,
      ready: 1,
    })),
  };
  await refreshMediaRuntimeAuthorities(db, await observer(async () => running));
  await expect(
    db.$transaction((tx) =>
      assertLatestLease(tx, { quiescence: stopped, recoveryEpoch: 0 }),
    ),
  ).rejects.toThrow("superseded by revocation");
  expect(await runtimeAuthority(db)).toEqual({ active: true, epoch: 0 });
  expect(await db.$transaction(commandAutomationEpoch)).toBe(0);
});

test.each(["existing", "absent"] as const)(
  "unavailable legacy observer revokes %s handoff evidence without stopping managed acquisitions",
  async (prior) => {
    const db = cluster.database;
    const stopped = stoppedWriters();
    if (prior === "existing") await refreshWriterLease(db, async () => stopped);
    const before = await db.mediaStorageAuthority.findMany({
      orderBy: { rootPath: "asc" },
    });
    await expect(
      refreshMediaRuntimeAuthorities(
        db,
        await observer(() =>
          Promise.reject(new Error("Legacy inventory unavailable")),
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      db.$transaction((tx) =>
        assertLatestLease(tx, { quiescence: stopped, recoveryEpoch: 0 }),
      ),
    ).rejects.toThrow("superseded by revocation");
    const after = await db.mediaStorageAuthority.findMany({
      orderBy: { rootPath: "asc" },
    });
    expect(after.map(({ version: _version, ...row }) => row)).toEqual(
      before.map(({ version: _version, ...row }) => row),
    );
    const lease = await db.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    expect(lease.observation).toMatchObject({
      kind: "legacy_observer_unavailable",
    });
    expect(lease.revokedAt).not.toBeNull();
    expect(await runtimeAuthority(db)).toEqual({ active: true, epoch: 0 });
    expect(await db.$transaction(commandAutomationEpoch)).toBe(0);
  },
);
