import { expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";

test("021 preserves populated native/archive history and makes supersession one-way without relaxing old receipt grants", async () => {
  const cluster = await startMediaTestPostgres({
    migrationCeiling: "20261017002000_native_archive_cleanup",
  });
  const db = cluster.database;
  try {
    const owner = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Original owner",
        role: "owner",
      },
    });
    const operation = await db.operation.create({
      data: {
        idempotencyKey: crypto.randomUUID(),
        kind: "restore_observe",
        status: "completed",
        payload: { historical: true },
        result: { recoveryEpoch: 1 },
      },
    });
    const asset = await db.libraryAsset.create({
      data: {
        path: "/data/movies/original.mkv",
        sizeBytes: 10n,
        owned: true,
        ownershipEpoch: 0,
        checksum: "a".repeat(64),
        properties: { original: true },
        state: "superseded",
      },
    });
    const cleanup = await db.upgradeCleanup.create({
      data: {
        assetId: asset.id,
        successorAssetId: crypto.randomUUID(),
        recoveryEpoch: 0,
        expiresAt: new Date("2020-01-08"),
        version: 4,
        manifest: { historical: "unchanged" },
      },
    });
    const plan = await db.nativeRecoveryPlan.create({
      data: {
        actorId: owner.id,
        restoreOperationId: operation.id,
        recoveryEpoch: 1,
        runtimeVersion: 2,
        requestHash: "b".repeat(64),
        scope: { schemaVersion: 1, old: true },
        state: "applied",
        plan: { original: true },
        planHash: "c".repeat(64),
      },
    });
    const receipt = await db.nativeRecoveryReceipt.create({
      data: {
        actorId: owner.id,
        planId: plan.id,
        planHash: "c".repeat(64),
        recoveryEpoch: 1,
        previousRuntimeVersion: 2,
        runtimeVersion: 3,
        selection: { original: true },
      },
    });
    const continuationId = crypto.randomUUID();
    await db.$executeRaw`INSERT INTO "NativeArchiveCleanupContinuation" (id,"receiptId","originalCleanupId","recoveryEpoch",descriptor,"descriptorHash","updatedAt") VALUES (${continuationId},${receipt.id},${cleanup.id},1,'{"original":true}'::jsonb,${"d".repeat(64)},CURRENT_TIMESTAMP)`;
    const snapshot = () =>
      db.$queryRaw`SELECT jsonb_build_object('asset',(SELECT to_jsonb(a) FROM "LibraryAsset" a WHERE id=${asset.id}),'cleanup',(SELECT to_jsonb(c) FROM "UpgradeCleanup" c WHERE id=${cleanup.id}),'plan',(SELECT to_jsonb(p) FROM "NativeRecoveryPlan" p WHERE id=${plan.id}),'receipt',(SELECT to_jsonb(r) FROM "NativeRecoveryReceipt" r WHERE id=${receipt.id}),'archive',(SELECT to_jsonb(c)-'supersession' FROM "NativeArchiveCleanupContinuation" c WHERE id=${continuationId}))::text AS original`;
    const before = await snapshot();
    cluster.applyMigration("20261017002100_publication_compensation");
    expect(await snapshot()).toEqual(before);
    expect(await db.mediaPublicationTransition.count()).toBe(0);
    expect(await db.nativePublicationCompensationContinuation.count()).toBe(0);
    const row = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: continuationId },
    });
    expect(row.supersession).toBeNull();
    for (const supersession of [
      {},
      { schemaVersion: 1 },
      {
        schemaVersion: 1,
        continuationId: crypto.randomUUID(),
        descriptorHash: row.descriptorHash,
      },
    ]) {
      await expect(
        db.nativeArchiveCleanupContinuation.update({
          where: { id: row.id },
          data: { state: "superseded", supersession },
        }),
      ).rejects.toThrow();
    }
    await db.nativeArchiveCleanupContinuation.update({
      where: { id: row.id },
      data: {
        state: "superseded",
        supersession: {
          schemaVersion: 1,
          continuationId: row.id,
          descriptorHash: row.descriptorHash,
        },
      },
    });
    await expect(
      db.nativeArchiveCleanupContinuation.update({
        where: { id: row.id },
        data: { state: "cleaning" },
      }),
    ).rejects.toThrow();
    await expect(
      db.nativeArchiveCleanupContinuation.update({
        where: { id: row.id },
        data: { coordinatorOperationId: operation.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.nativeArchiveCleanupContinuation.update({
        where: { id: row.id },
        data: { completion: { changed: true } },
      }),
    ).rejects.toThrow();
    await expect(
      db.nativeArchiveCleanupContinuation.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    await db.nativeRecoveryObservation.create({
      data: {
        planId: plan.id,
        kind: "compensation_network",
        evidence: { schemaVersion: 2 },
        evidenceHash: "e".repeat(64),
        observedAt: new Date("2020-01-01"),
        expiresAt: new Date("2020-01-02"),
      },
    });
    const other = await db.nativeRecoveryPlan.create({
      data: {
        actorId: owner.id,
        restoreOperationId: operation.id,
        recoveryEpoch: 1,
        runtimeVersion: 3,
        requestHash: "f".repeat(64),
        scope: {},
      },
    });
    await expect(
      db.nativeRecoveryReceipt.create({
        data: {
          actorId: owner.id,
          planId: other.id,
          planHash: "c".repeat(64),
          recoveryEpoch: 1,
          previousRuntimeVersion: 3,
          runtimeVersion: 3,
          selection: {
            scope: {
              schemaVersion: 2,
              lifecycleKind: "publication_compensation",
              request: { activation: "extend" },
            },
            bindings: [],
            reusedBindings: [{ receiptId: receipt.id }],
          },
        },
      }),
    ).rejects.toThrow();
  } finally {
    await cluster.close();
  }
});
