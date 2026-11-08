import { expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";

function reuseSelections(receiptId: string) {
  const valid = {
    scope: {
      schemaVersion: 2,
      lifecycleKind: "superseded_archive",
      request: { activation: "extend" },
    },
    bindings: [],
    reusedBindings: [{ receiptId }],
  };
  const selections = [
    {},
    { ...valid, scope: { schemaVersion: 1 } },
    {
      ...valid,
      scope: { ...valid.scope, request: { activation: "activate" } },
    },
    { ...valid, bindings: [{}] },
    { ...valid, reusedBindings: [] },
    { ...valid, reusedBindings: {} },
    { ...valid, reusedBindings: Array.from({ length: 26 }, () => ({})) },
  ];
  return { valid, selections };
}

test("020 preserves populated history and admits only exact archive observation/reuse branches", async () => {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017001900_watch_observation_fence",
  });
  const db = cluster.database;
  try {
    const actor = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Historical owner",
        role: "owner",
      },
    });
    const operation = await db.operation.create({
      data: {
        idempotencyKey: crypto.randomUUID(),
        kind: "restore_observe",
        status: "completed",
        payload: { historical: "unchanged" },
        result: { historicalEpoch: 1 },
      },
    });
    const asset = await db.libraryAsset.create({
      data: {
        path: `/data/movies/.media-control/rollback/${crypto.randomUUID()}`,
        sizeBytes: 100n,
        checksum: "a".repeat(64),
        properties: { original: "unchanged" },
        owned: true,
        state: "superseded",
        ownershipEpoch: 0,
        version: 2,
      },
    });
    const cleanup = await db.upgradeCleanup.create({
      data: {
        assetId: asset.id,
        successorAssetId: crypto.randomUUID(),
        recoveryEpoch: 0,
        expiresAt: new Date("2020-01-08"),
        manifest: { historical: "literal" },
        version: 7,
      },
    });
    const plan = await db.nativeRecoveryPlan.create({
      data: {
        restoreOperationId: operation.id,
        actorId: actor.id,
        recoveryEpoch: 1,
        runtimeVersion: 2,
        requestHash: "b".repeat(64),
        scope: { schemaVersion: 1, original: "unchanged" },
        plan: { original: "unchanged" },
        planHash: "c".repeat(64),
        state: "applied",
      },
    });
    const receipt = await db.nativeRecoveryReceipt.create({
      data: {
        planId: plan.id,
        actorId: actor.id,
        recoveryEpoch: 1,
        previousRuntimeVersion: 2,
        runtimeVersion: 3,
        planHash: "c".repeat(64),
        selection: { scope: { schemaVersion: 1 }, original: "unchanged" },
      },
    });
    const snapshot = () =>
      db.$queryRaw`SELECT jsonb_build_object('cleanup',(SELECT to_jsonb(c) FROM "UpgradeCleanup" c WHERE id=${cleanup.id}),'asset',(SELECT to_jsonb(a) FROM "LibraryAsset" a WHERE id=${asset.id}),'plan',(SELECT to_jsonb(p) FROM "NativeRecoveryPlan" p WHERE id=${plan.id}),'receipt',(SELECT to_jsonb(r) FROM "NativeRecoveryReceipt" r WHERE id=${receipt.id}),'operation',(SELECT to_jsonb(o) FROM "Operation" o WHERE id=${operation.id}))::text AS value`;
    const before = await snapshot();
    cluster.applyMigration("20261017002000_native_archive_cleanup");
    expect(await snapshot()).toEqual(before);
    expect(await db.nativeArchiveCleanupContinuation.count()).toBe(0);
    const continuation = await db.nativeArchiveCleanupContinuation.create({
      select: { id: true },
      data: {
        receiptId: receipt.id,
        originalCleanupId: cleanup.id,
        recoveryEpoch: 1,
        descriptor: { original: "immutable" },
        descriptorHash: "d".repeat(64),
      },
    });
    await expect(
      db.nativeArchiveCleanupContinuation.update({
        select: { id: true },
        where: { id: continuation.id },
        data: { descriptor: { changed: true } },
      }),
    ).rejects.toThrow();
    await db.nativeArchiveCleanupContinuation.update({
      select: { id: true },
      where: { id: continuation.id },
      data: { executionEvidence: { original: true } },
    });
    await expect(
      db.nativeArchiveCleanupContinuation.update({
        select: { id: true },
        where: { id: continuation.id },
        data: { executionEvidence: { changed: true } },
      }),
    ).rejects.toThrow();
    await db.nativeArchiveCleanupContinuation.update({
      select: { id: true },
      where: { id: continuation.id },
      data: { completion: { original: true }, state: "cleaned" },
    });
    await expect(
      db.nativeArchiveCleanupContinuation.update({
        select: { id: true },
        where: { id: continuation.id },
        data: { completion: { changed: true } },
      }),
    ).rejects.toThrow();
    await expect(
      db.nativeArchiveCleanupContinuation.delete({
        select: { id: true },
        where: { id: continuation.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.nativeArchiveCleanupContinuation.create({
        select: { id: true },
        data: {
          receiptId: receipt.id,
          originalCleanupId: crypto.randomUUID(),
          recoveryEpoch: 1,
          descriptor: {},
          descriptorHash: "d".repeat(64),
        },
      }),
    ).rejects.toThrow();
    const observation = {
      planId: plan.id,
      kind: "archive_cleanup_network",
      evidenceHash: "e".repeat(64),
      evidence: { schemaVersion: 2 },
      observedAt: new Date("2020-01-01"),
      expiresAt: new Date("2020-01-02"),
    };
    await db.nativeRecoveryObservation.create({ data: observation });
    await expect(
      db.nativeRecoveryObservation.create({
        data: { ...observation, kind: "archive_other" },
      }),
    ).rejects.toThrow();
    const { valid, selections } = reuseSelections(receipt.id);
    for (const selection of [...selections, valid]) {
      const next = await db.nativeRecoveryPlan.create({
        data: {
          restoreOperationId: operation.id,
          actorId: actor.id,
          recoveryEpoch: 1,
          runtimeVersion: 3,
          requestHash: "b".repeat(64),
          scope: selection,
        },
      });
      const create = () =>
        db.nativeRecoveryReceipt.create({
          data: {
            planId: next.id,
            actorId: actor.id,
            recoveryEpoch: 1,
            previousRuntimeVersion: 3,
            runtimeVersion: 3,
            planHash: "c".repeat(64),
            selection,
          },
        });
      if (selection === valid)
        await expect(create()).resolves.toMatchObject({
          runtimeVersion: 3,
          previousRuntimeVersion: 3,
        });
      else await expect(create()).rejects.toThrow();
    }
  } finally {
    await cluster.close();
  }
});
