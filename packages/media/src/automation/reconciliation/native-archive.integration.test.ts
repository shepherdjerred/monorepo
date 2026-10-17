import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { sweepInventory } from "./inventory.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("resumed old cleanup cursor skips historical rows and independently pages live archive coordinators", async () => {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.context().cipher);
  directories.push(f.file.directory);
  await f.prepare();
  const receiptId = await f.apply();
  const actual = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
    where: { receiptId },
  });
  // Pagination records are intentionally never submitted for physical validation:
  // every synthetic coordinator is still running. Only `actual` is producer authority.
  const historical = [];
  for (let index = 0; index < 28; index++) {
    historical.push(
      await db.upgradeCleanup.create({
        data: {
          assetId: f.first.assetId,
          successorAssetId: crypto.randomUUID(),
          recoveryEpoch: 0,
          expiresAt: new Date(1),
        },
      }),
    );
  }
  for (const cleanup of historical.slice(0, 26)) {
    const operation = await db.operation.create({
      data: {
        kind: "cleanup_native_archive",
        targetId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        status: "running",
        payload: {},
      },
    });
    await db.nativeArchiveCleanupContinuation.create({
      data: {
        receiptId,
        originalCleanupId: cleanup.id,
        recoveryEpoch: actual.recoveryEpoch,
        descriptor: z.record(z.string(), z.json()).parse(actual.descriptor),
        descriptorHash: actual.descriptorHash,
        coordinatorOperationId: operation.id,
        state: "cleaning",
      },
    });
  }
  const context = harness.context();
  const described: string[] = [];
  context.describeWorkflow = (id) => {
    described.push(id);
    return Promise.resolve({ status: "RUNNING", runId: crypto.randomUUID() });
  };
  const scan = await db.reconciliationScan.create({
    data: {
      id: crypto.randomUUID(),
      kind: "inventory",
      progress: {
        section: 3,
        offset: 0,
        assetCursor: "00000000-0000-4000-8000-000000000000",
      },
    },
  });
  const priorOperations = await db.operation.count({
    where: { kind: "cleanup_upgrade" },
  });
  expect(await sweepInventory(context, scan.id)).toEqual({
    processed: 0,
    nextCursor: "archives",
  });
  expect(await db.operation.count({ where: { kind: "cleanup_upgrade" } })).toBe(
    priorOperations,
  );
  const first = await sweepInventory(context, scan.id);
  expect(first.processed).toBe(25);
  expect(first.nextCursor).not.toBeNull();
  const second = await sweepInventory(context, scan.id);
  expect(second).toEqual({ processed: 2, nextCursor: null });
  expect(new Set(described).size).toBe(26);
  const current = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: actual.id },
  });
  expect(current.coordinatorOperationId).not.toBeNull();
  expect(
    await db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(current.coordinatorOperationId) },
    }),
  ).toMatchObject({ kind: "cleanup_native_archive", targetId: actual.id });
  expect(
    await db.reconciliationScan.findUniqueOrThrow({ where: { id: scan.id } }),
  ).toMatchObject({ state: "completed" });
});
