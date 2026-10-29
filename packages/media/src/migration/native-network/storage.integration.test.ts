import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { refreshStorageAuthorities } from "#infrastructure/handoff/storage-observer.ts";
import {
  resolveNativeStorageRoots,
  assertNativeStorageRoots,
} from "#infrastructure/native-recovery/storage-provenance.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { z } from "zod";
import { activateNativeFixture, nativeNetworkFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
async function fixture() {
  const f = await nativeNetworkFixture(
    harness.database(),
    harness.context().cipher,
  );
  await activateNativeFixture(f);
  f.context.observer.observeMountBindings = () =>
    Promise.reject(
      new Error("Native refresh cannot use legacy source aliases"),
    );
  return f;
}
test("native storage renewal permits a new actual Pod on the same durably approved roots", async () => {
  const f = await fixture();
  for (const mount of f.canonical.mounts) mount.podUid = "replacement-pod";
  await refreshStorageAuthorities(f.context.db, f.context.observer);
  const rows = await f.context.db.mediaStorageAuthority.findMany();
  expect(
    rows.every(
      (row) => row.workerPodUid === "replacement-pod" && row.revokedAt === null,
    ),
  ).toBe(true);
  expect(
    await f.context.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "active", recoveryEpoch: 1 });
});
test.each([
  "pvc",
  "volume",
  "subpath",
  "expired",
  "receipt",
  "revoked-lease",
  "old-lease-epoch",
  "row-replacement",
])(
  "native refresh revokes %s without blessing replacement storage",
  async (mode) => {
    const f = await fixture();
    const mount = f.canonical.mounts[0];
    if (!mount) throw new Error("Fixture mount absent");
    if (mode === "pvc" || mode === "row-replacement")
      mount.pvcUid = "replacement-pvc";
    if (mode === "volume") mount.volumeName = "replacement-pv";
    if (mode === "subpath") mount.volumePath = "different-directory";
    if (mode === "expired") f.canonical.expiresAt = new Date(0).toISOString();
    if (mode === "receipt") {
      const root = f.roots[0];
      if (!root) throw new Error("Missing fixture root");
      root.receipt.planHash = "f".repeat(64);
      await f.context.db.mediaStorageAuthority.updateMany({
        data: {
          evidence: {
            schemaVersion: 1,
            kind: "native_restore",
            approvedRoots: f.roots,
            mounts: f.canonical,
          },
        },
      });
    }
    if (mode === "revoked-lease")
      await f.context.db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: { revokedAt: new Date() },
      });
    if (mode === "old-lease-epoch")
      await f.context.db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: 0 },
      });
    if (mode === "row-replacement")
      await f.context.db.mediaStorageAuthority.update({
        where: { rootPath: mount.root },
        data: {
          pvcUid: mount.pvcUid,
          evidence: {
            schemaVersion: 1,
            kind: "native_restore",
            approvedRoots: f.roots,
            mounts: f.canonical,
          },
        },
      });
    await refreshStorageAuthorities(f.context.db, f.context.observer);
    expect(
      await f.context.db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toMatchObject({ mode: "observe", ownershipConfirmed: false });
    const rows = await f.context.db.mediaStorageAuthority.findMany();
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  },
);
test("storage authority rows alone cannot create native recovery approval", async () => {
  const f = await fixture();
  for (const mount of f.canonical.mounts) {
    mount.pvcUid = `unapproved-${mount.pvcUid}`;
    await f.context.db.mediaStorageAuthority.update({
      where: { rootPath: mount.root },
      data: {
        pvcUid: mount.pvcUid,
        evidence: {
          schemaVersion: 1,
          kind: "native_restore",
          approvedRoots: f.roots,
          mounts: f.canonical,
        },
      },
    });
  }
  const changedRows = await f.context.db.mediaStorageAuthority.findMany({
    orderBy: { rootPath: "asc" },
  });
  await expect(resolveNativeStorageRoots(f.context.db)).rejects.toThrow(
    "Native storage pinned approval identity changed",
  );
  expect(
    await f.context.db.mediaStorageAuthority.findMany({
      orderBy: { rootPath: "asc" },
    }),
  ).toEqual(changedRows);
});
test("runtime changes while canonical storage is observed are never overwritten", async () => {
  const f = await fixture();
  f.context.observer.observeCanonicalMounts = async () => {
    await f.context.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: {
        recoveryEpoch: 2,
        version: { increment: 1 },
        mode: "observe",
        ownershipConfirmed: false,
      },
    });
    return f.canonical;
  };
  await refreshStorageAuthorities(f.context.db, f.context.observer);
  expect(
    await f.context.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "observe", recoveryEpoch: 2 });
  const rows = await f.context.db.mediaStorageAuthority.findMany();
  expect(rows.every((row) => row.version === 0)).toBe(true);
});
test("a later native receipt can supply both durable root approvals for the next restore", async () => {
  const f = await fixture();
  const network = {
    mounts: f.canonical.mounts,
    configurationDigest: f.canonical.configurationDigest,
  };
  const finished = {
    schemaVersion: 1,
    scopeHash: snapshotHash(z.json().parse(f.scope)),
    network,
    files: [],
  };
  const planHash = snapshotHash(finished);
  await f.context.db.nativeRecoveryPlan.update({
    where: { id: f.nativePlan.id },
    data: { state: "applied", plan: finished, planHash },
  });
  const receipt = await f.context.db.nativeRecoveryReceipt.create({
    data: {
      planId: f.nativePlan.id,
      planHash,
      recoveryEpoch: 1,
      previousRuntimeVersion: f.nativePlan.runtimeVersion,
      runtimeVersion: f.nativePlan.runtimeVersion + 1,
      actorId: f.actor.id,
      selection: { scope: f.scope, networkEvidence: network, fileEvidence: [] },
    },
  });
  // Discovery keeps the installed approvals; selecting the exact newer receipt
  // is an explicit reviewed operation, never a latest-receipt fallback.
  expect(await resolveNativeStorageRoots(f.context.db)).toEqual(f.roots);
  const reviewedRoots = f.roots.map((root) => ({
    ...root,
    receipt: { kind: "native" as const, id: receipt.id, planHash },
  }));
  const roots = await resolveNativeStorageRoots(
    f.context.db,
    undefined,
    reviewedRoots,
  );
  expect(
    roots.every(
      (root) =>
        root.receipt.kind === "native" && root.receipt.id === receipt.id,
    ),
  ).toBe(true);
  expect(await assertNativeStorageRoots(f.context.db, roots)).toEqual(roots);
  const first = roots[0];
  if (!first) throw new Error("Fixture root absent");
  first.receipt.planHash = "f".repeat(64);
  await expect(assertNativeStorageRoots(f.context.db, roots)).rejects.toThrow(
    "approval missing or changed",
  );
});
test("a receipt cannot approve network evidence different from its immutable reviewed plan", async () => {
  const f = await fixture();
  const network = {
    mounts: f.canonical.mounts,
    configurationDigest: f.canonical.configurationDigest,
  };
  const finished = {
    schemaVersion: 1,
    scopeHash: snapshotHash(z.json().parse(f.scope)),
    network: { ...network, configurationDigest: "f".repeat(64) },
    files: [],
  };
  const planHash = snapshotHash(finished);
  await f.context.db.nativeRecoveryPlan.update({
    where: { id: f.nativePlan.id },
    data: { state: "applied", plan: finished, planHash },
  });
  const receipt = await f.context.db.nativeRecoveryReceipt.create({
    data: {
      planId: f.nativePlan.id,
      planHash,
      recoveryEpoch: 1,
      previousRuntimeVersion: f.nativePlan.runtimeVersion,
      runtimeVersion: f.nativePlan.runtimeVersion + 1,
      actorId: f.actor.id,
      selection: { scope: f.scope, networkEvidence: network, fileEvidence: [] },
    },
  });
  const roots = f.roots.map((root) => ({
    ...root,
    receipt: { kind: "native" as const, id: receipt.id, planHash },
  }));
  await expect(assertNativeStorageRoots(f.context.db, roots)).rejects.toThrow(
    "approval missing or changed",
  );
});
