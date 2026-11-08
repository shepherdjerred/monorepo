import { afterAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { grantTestManagedStorage } from "#testing/managed-storage.ts";
import { grantTestLease } from "#testing/authority.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import { setManagedRuntime } from "#infrastructure/handoff/parallel-runtime.ts";
import { readRuntimeProof } from "#infrastructure/handoff/runtime-proof.ts";
import { refreshManagedStorage } from "#infrastructure/handoff/managed-storage.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import {
  CanonicalMountEvidenceSchema,
  NativeStorageAuthoritySchema,
} from "#shared/canonical-storage.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import { nativeReviewPlexFixture } from "#automation/native-recovery/fixtures/plex.ts";
import { createNativeFileActivities } from "#automation/native-recovery/activities.ts";
import type { NativeRecoveryObserverContext } from "#migration/native-network/producer.ts";
import { PrismaNativeRecovery } from "./service.ts";
import {
  resolveNativeStorageRoots,
  assertNativeStorageRoots,
} from "./storage-provenance.ts";

const harness = automationTestHarness();
let directory: string | undefined;
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

async function managedRestore() {
  const db = harness.database();
  const file = await mappedPublicationFixture(db);
  directory = file.directory;
  const owner = await db.mediaUser.update({
    where: { id: file.user.id },
    data: { role: "owner" },
  });
  await grantTestManagedStorage(db);
  await expect(resolveNativeStorageRoots(db)).rejects.toThrow(
    "durable owner-approved receipt",
  );
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  await db.$transaction((tx) =>
    setManagedRuntime(
      tx,
      { mode: "active", expectedVersion: runtime.version },
      owner.id,
    ),
  );
  const roots = await resolveNativeStorageRoots(db);
  expect(roots.every((root) => root.receipt.kind === "managed")).toBe(true);
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  expect(await resolveNativeStorageRoots(db, budget)).toEqual(roots);
  expect(() => budget.consume(1)).toThrow("100 total queried records");
  const approval = await db.applicationEvent.findUniqueOrThrow({
    where: { id: z.uuid().parse(roots[0]?.receipt.id) },
  });
  await expect(
    db.applicationEvent.update({
      where: { id: approval.id },
      data: { actorId: crypto.randomUUID() },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    db.applicationEvent.update({
      where: { id: approval.id },
      data: { payload: {} },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    db.applicationEvent.delete({ where: { id: approval.id } }),
  ).rejects.toThrow("immutable");
  const changed = roots.map((root) => ({
    ...root,
    receipt: { ...root.receipt, planHash: "0".repeat(64) },
  }));
  await expect(assertNativeStorageRoots(db, changed)).rejects.toThrow(
    "approval missing or changed",
  );
  await db.$executeRaw`SELECT media_series_pack_native_storage_original_v1(${JSON.stringify({ storageRoots: roots })}::jsonb, ${snapshotHash(LEGACY_OBSERVER_CONFIG)})`;
  await expect(
    db.$executeRaw`SELECT media_series_pack_native_storage_original_v1(${JSON.stringify({ storageRoots: changed })}::jsonb, ${snapshotHash(LEGACY_OBSERVER_CONFIG)})`,
  ).rejects.toThrow("owner approval changed");
  const published = await file.published();
  await db.acquisitionAttempt.update({
    where: { id: published.attempt.id },
    data: { state: "completed" },
  });
  // A completed publication no longer needs a live download source for file reproof.
  await db.libraryAsset.update({
    where: { id: published.entry.assetId },
    data: { torrentId: null },
  });
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: 0,
    reason: "Managed-only physical library restore",
  });
  const restore = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  await grantTestExclusionProofs(db, owner.id, "fixture-server");
  const current = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const service = new PrismaNativeRecovery(db);
  const inventory = await service.inventory(owner);
  expect(inventory.prerequisites).not.toContain(
    "prior_approved_storage_receipt_required",
  );
  const prepared = await service.prepare(owner, crypto.randomUUID(), {
    restoreOperationId: restore.id,
    recoveryEpoch: current.recoveryEpoch,
    runtimeVersion: current.version,
    activation: "activate",
    assetIds: [published.entry.assetId],
  });
  const planId = z.uuid().parse(prepared.nativeRecoveryId);
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const stored = await db.mediaStorageAuthority.findFirstOrThrow();
  const mounts = CanonicalMountEvidenceSchema.parse(stored.evidence);
  const quiescence = () => {
    const now = new Date();
    return QuiescenceEvidenceSchema.parse({
      schemaVersion: 1,
      namespace: "media",
      capturedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90_000).toISOString(),
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
    });
  };
  const observer: NativeRecoveryObserverContext = {
    db,
    expectedServerMachineId: "fixture-server",
    permittedSections: async () => ({ movie: "1", series: "2" }),
    plex: harness.context().plex,
    qbittorrent: { listAll: async () => [] },
    observer: {
      observe: async () => quiescence(),
      observeCanonicalMounts: async () => mounts,
      observeMountBindings: async () => {
        throw new Error("Managed restore has no legacy bindings");
      },
    },
  };
  const network = await nativeReviewPlexFixture(
    observer,
    NativeStoredScopeSchema.parse(plan.scope),
  );
  const activities = createNativeFileActivities({
    files: file.context,
    workerPodUid: z.string().parse(mounts.mounts[0]?.podUid),
  });
  const prepareInput = {
    planId,
    operationId: z.uuid().parse(prepared.operationId),
  };
  await network.observe(prepareInput);
  await activities.prepareNativeRecoveryFiles(prepareInput);
  const detail = await service.detail(owner, planId);
  const reviewed = await service.apply(owner, crypto.randomUUID(), planId, {
    expectedVersion: detail.version,
    planHash: z.string().parse(detail.planHash),
    recoveryEpoch: current.recoveryEpoch,
    runtimeVersion: current.version,
    acknowledgePhysicalOwnershipOnly: true,
    acknowledgeRecoveryHolds: true,
    acknowledgeSubtitlePolicies: true,
  });
  const applyInput = {
    planId,
    operationId: z.uuid().parse(reviewed.operationId),
  };
  await network.observe(applyInput);
  await activities.applyNativeRecoveryFiles(applyInput);
  return { db, file, published, roots, owner, current, mounts };
}

test("a managed-only published file retains durable owner approval through native restore and ordinary renewal", async () => {
  const {
    db,
    file,
    published,
    roots,
    owner,
    current,
    mounts: initialMounts,
  } = await managedRestore();
  let mounts = initialMounts;
  expect(await db.mediaHandoffReceipt.count()).toBe(0);
  expect(await db.migrationBundle.count()).toBe(0);
  const restored = await db.mediaStorageAuthority.findMany();
  expect(
    restored.every((row) =>
      NativeStorageAuthoritySchema.parse(row.evidence).approvedRoots.every(
        (root) => root.receipt.kind === "managed",
      ),
    ),
  ).toBe(true);
  await db.legacyWriterLease.deleteMany();
  const runtimeBudget = new PublicationAuthorityReadBudget();
  runtimeBudget.consume(99);
  expect(await readRuntimeProof(db, runtimeBudget)).toMatchObject({
    kind: "canonical_storage",
  });
  expect(() => runtimeBudget.consume(1)).toThrow("100 total queried records");
  await expect(readRuntimeProof(db, runtimeBudget)).rejects.toThrow(
    "100 total queried records",
  );
  expect(await readRuntimeProof(db)).toMatchObject({
    kind: "canonical_storage",
  });
  await db.$queryRaw`SELECT * FROM media_runtime_proof_v1()`;
  mounts = {
    ...mounts,
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    mounts: mounts.mounts.map((mount) => ({
      ...mount,
      podUid: "replacement-worker",
    })),
  };
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts,
  });
  expect(await readRuntimeProof(db)).toMatchObject({
    kind: "canonical_storage",
  });
  expect(await resolveNativeStorageRoots(db)).toEqual(roots);
  const renewed = await db.mediaStorageAuthority.findMany();
  await grantTestLease(db, current.recoveryEpoch);
  for (const malformed of [
    {
      kind: "native_restore",
      approvedRoots: { receipt: { kind: "managed" } },
      mounts: {},
    },
    { kind: "native_restore", mounts: {} },
    {
      ...NativeStorageAuthoritySchema.parse(renewed[0]?.evidence),
      approvedRoots: [],
    },
    {
      ...NativeStorageAuthoritySchema.parse(renewed[0]?.evidence),
      schemaVersion: 2,
    },
    {
      ...NativeStorageAuthoritySchema.parse(renewed[0]?.evidence),
      approvedRoots: roots.map((root) => ({
        ...root,
        receipt: { ...root.receipt, planHash: "0".repeat(64) },
      })),
    },
    { ...NativeStorageAuthoritySchema.parse(renewed[0]?.evidence), mounts: {} },
    {
      ...NativeStorageAuthoritySchema.parse(renewed[0]?.evidence),
      approvedRoots: roots.map((root, index) =>
        index === 0
          ? root
          : { ...root, receipt: { ...root.receipt, kind: "legacy" } },
      ),
    },
    {
      ...NativeStorageAuthoritySchema.parse(renewed[0]?.evidence),
      approvedRoots: [roots[0]],
    },
  ]) {
    await db.mediaStorageAuthority.updateMany({
      data: { evidence: z.record(z.string(), z.json()).parse(malformed) },
    });
    await expect(readRuntimeProof(db)).rejects.toThrow();
    await expect(
      db.$queryRaw`SELECT * FROM media_runtime_proof_v1()`,
    ).rejects.toThrow();
  }
  for (const row of renewed)
    await db.mediaStorageAuthority.update({
      where: { rootPath: row.rootPath },
      data: { evidence: z.record(z.string(), z.json()).parse(row.evidence) },
    });
  await db.legacyWriterLease.deleteMany();
  const active = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  await db.$transaction((tx) =>
    setManagedRuntime(
      tx,
      { mode: "observe", expectedVersion: active.version },
      owner.id,
    ),
  );
  const expired = {
    ...mounts,
    capturedAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt: new Date(Date.now() - 30_000).toISOString(),
  };
  await db.mediaStorageAuthority.updateMany({
    data: {
      evidence: {
        schemaVersion: 1,
        kind: "native_restore",
        approvedRoots: roots,
        mounts: expired,
      },
      observedAt: new Date(expired.capturedAt),
      expiresAt: new Date(expired.expiresAt),
    },
  });
  mounts = {
    ...mounts,
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  };
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts,
  });
  expect(await readRuntimeProof(db)).toMatchObject({
    kind: "canonical_storage",
  });
  const paused = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  expect(paused.mode).toBe("observe");
  await db.$transaction((tx) =>
    setManagedRuntime(
      tx,
      { mode: "active", expectedVersion: paused.version },
      owner.id,
    ),
  );
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => {
      throw new Error("Unavailable observer");
    },
  });
  await expect(readRuntimeProof(db)).rejects.toThrow("expired");
  mounts = {
    ...mounts,
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
  };
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => mounts,
  });
  const recovered = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  expect(recovered.mode).toBe("observe");
  expect(await readRuntimeProof(db)).toMatchObject({
    kind: "canonical_storage",
  });
  await db.$transaction((tx) =>
    setManagedRuntime(
      tx,
      { mode: "active", expectedVersion: recovered.version },
      owner.id,
    ),
  );
  await db.$queryRaw`SELECT * FROM media_runtime_proof_v1()`;
  expect(
    await readFile(
      path.join(file.context.roots.movies.library, published.entry.libraryPath),
      "utf8",
    ),
  ).toBe(published.content);
  const changedMounts = {
    ...mounts,
    mounts: mounts.mounts.map((mount) => ({
      ...mount,
      pvcUid: "unapproved-replacement",
    })),
  };
  await refreshManagedStorage(db, {
    observeCanonicalMounts: async () => changedMounts,
  });
  await expect(readRuntimeProof(db)).rejects.toThrow("expired");
}, 60_000);
