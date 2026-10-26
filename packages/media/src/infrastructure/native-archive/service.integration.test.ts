import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { NativeArchiveContinuationSchema } from "#shared/native-recovery/archive.ts";
import { resolveArchiveBindings } from "./bindings.ts";
import { z } from "zod";
import { archiveReviewObserver } from "#automation/native-archive/fixtures/observe.ts";
import { prepareNativeArchiveFiles } from "#automation/native-archive/files.ts";
import { finishArchivePreparation } from "#automation/native-archive/plan.ts";
import { applyPreparedNativeArchive } from "#automation/native-archive/apply.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("later B-only approval reuses the exact A-only grants without renewing versions, holds or runtime", async () => {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 3,
    selected: "first",
    withArchiveSubtitles: true,
  });
  directories.push(f.file.directory);
  await f.prepare();
  const priorReceiptId = await f.apply();
  const later = f.cleanups.find((item) => item.id !== f.first.id);
  if (later === undefined) throw new Error("Later cleanup missing");
  const before = {
    assets: await db.libraryAsset.findMany({ orderBy: { id: "asc" } }),
    subtitles: await db.subtitleAsset.findMany({ orderBy: { id: "asc" } }),
    holds: await db.recoveryHold.findMany({ orderBy: { mediaId: "asc" } }),
    intents: await db.mediaIntent.findMany({ orderBy: { mediaId: "asc" } }),
    runtime: await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  };
  const command = await f.service.prepare(f.prior.actor, crypto.randomUUID(), {
    restoreOperationId: f.restore.id,
    recoveryEpoch: before.runtime.recoveryEpoch,
    runtimeVersion: before.runtime.version,
    activation: "extend",
    cleanupIds: [later.id],
  });
  const planId = z.uuid().parse(command.nativeRecoveryId);
  const prepareInput = {
    planId,
    operationId: z.uuid().parse(command.operationId),
  };
  const observe = archiveReviewObserver(f.observerContext);
  await observe(prepareInput);
  await finishArchivePreparation(
    f.context,
    prepareInput,
    await prepareNativeArchiveFiles(f.context, prepareInput),
  );
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const approval = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    planId,
    {
      expectedVersion: plan.version,
      planHash: z.string().parse(plan.planHash),
      recoveryEpoch: plan.recoveryEpoch,
      runtimeVersion: plan.runtimeVersion,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  const input = {
    planId,
    operationId: z.uuid().parse(approval.operationId),
    planHash: z.string().parse(plan.planHash),
  };
  await observe(input);
  const receiptId = await applyPreparedNativeArchive(
    f.context,
    input,
    await prepareNativeArchiveFiles(f.context, input),
  );
  const receipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: receiptId },
  });
  expect(receipt.runtimeVersion).toBe(before.runtime.version);
  expect(receipt.previousRuntimeVersion).toBe(before.runtime.version);
  const selection = z
    .object({
      bindings: z.array(z.json()),
      reusedBindings: z.array(z.object({ receiptId: z.uuid() })),
    })
    .parse(receipt.selection);
  expect(selection.bindings).toEqual([]);
  expect(selection.reusedBindings).toHaveLength(2);
  expect(
    selection.reusedBindings.every((item) => item.receiptId === priorReceiptId),
  ).toBe(true);
  expect({
    assets: await db.libraryAsset.findMany({ orderBy: { id: "asc" } }),
    subtitles: await db.subtitleAsset.findMany({ orderBy: { id: "asc" } }),
    holds: await db.recoveryHold.findMany({ orderBy: { mediaId: "asc" } }),
    intents: await db.mediaIntent.findMany({ orderBy: { mediaId: "asc" } }),
    runtime: await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  }).toEqual(before);
  expect(
    await db.nativeArchiveCleanupContinuation.count({
      where: { originalCleanupId: later.id },
    }),
  ).toBe(1);
  const duplicateState = () =>
    Promise.all([
      db.nativeRecoveryPlan.findMany({ orderBy: { id: "asc" } }),
      db.nativeRecoveryReceipt.findMany({ orderBy: { id: "asc" } }),
      db.nativeArchiveCleanupContinuation.findMany({ orderBy: { id: "asc" } }),
      db.mediaRuntimeState.findUniqueOrThrow({ where: { id: "singleton" } }),
      db.recoveryHold.findMany({ orderBy: { mediaId: "asc" } }),
      db.libraryAsset.findMany({ orderBy: { id: "asc" } }),
      db.subtitleAsset.findMany({ orderBy: { id: "asc" } }),
    ]);
  const beforeDuplicate = await duplicateState();
  await expect(
    f.service.prepare(f.prior.actor, crypto.randomUUID(), {
      restoreOperationId: f.restore.id,
      recoveryEpoch: before.runtime.recoveryEpoch,
      runtimeVersion: before.runtime.version,
      activation: "extend",
      cleanupIds: [later.id],
    }),
  ).rejects.toThrow("already has current authority");
  expect(await duplicateState()).toEqual(beforeDuplicate);
});

test("actual A→B→C joint review grants only selected cleanup and resolves both complete dependency scopes", async () => {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 3,
    selected: "all",
  });
  directories.push(f.file.directory);
  const before = await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } });
  const oldAttempts = await db.acquisitionAttempt.findMany({
    orderBy: { id: "asc" },
  });
  await f.prepare();
  const receiptId = await f.apply();
  expect(await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } })).toEqual(
    before,
  );
  expect(
    await db.acquisitionAttempt.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(oldAttempts);
  const receipt = await db.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: receiptId },
  });
  const continuations = await db.nativeArchiveCleanupContinuation.findMany({
    where: { receiptId },
    orderBy: { originalCleanupId: "asc" },
  });
  expect(continuations).toHaveLength(2);
  for (const row of continuations) {
    const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
    const effective = await db.$transaction((tx) =>
      resolveArchiveBindings(tx, receipt, descriptor),
    );
    expect(effective.networkScope.files).toHaveLength(3);
    expect(effective.bindings).toHaveLength(3);
  }
});
