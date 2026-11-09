import { beforeEach, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { writerObservation } from "#testing/authority.ts";
import { grantTestManagedStorage } from "#testing/managed-storage.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";
import {
  commandAutomationEpoch,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { assertLatestLease } from "#automation/handoff/final-guards.ts";
import { refreshMediaRuntimeAuthorities } from "#automation/network.ts";

const { database } = automationTestHarness();
beforeEach(async () => {
  await database().mediaStorageAuthority.deleteMany();
  await database().legacyWriterLease.deleteMany();
  await database().mediaRuntimeState.update({
    where: { id: "singleton" },
    data: {
      mode: "active",
      ownershipConfirmed: true,
      recoveryEpoch: 0,
      version: 0,
    },
  });
  await grantTestManagedStorage(database());
});

async function observer(observe: () => Promise<QuiescenceEvidence>) {
  const row = await database().mediaStorageAuthority.findFirstOrThrow();
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
  const db = database();
  const stopped = writerObservation(true);
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
    const db = database();
    const stopped = writerObservation(true);
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
