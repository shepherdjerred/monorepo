import { afterAll, expect, test } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import {
  archiveReviewObserver,
  observeArchiveCleanup,
} from "#automation/native-archive/fixtures/observe.ts";
import { prepareMediaRestore } from "#infrastructure/recovery.ts";
import { grantTestExclusionProofs } from "#testing/exclusion.ts";
import {
  CleanupNativeArchiveInputSchema,
  NativeArchiveScopeSchema,
} from "#shared/native-recovery/archive.ts";
import { prepareNativeArchiveFiles } from "#automation/native-archive/files.ts";
import { finishArchivePreparation } from "#automation/native-archive/plan.ts";
import { applyPreparedNativeArchive } from "#automation/native-archive/apply.ts";
import { queueNativeArchiveCleanup } from "./continuation.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test("second restored backup proves purged B before rebaselining A→B→current C without resurrecting B", async () => {
  const db = harness.database();
  const f = await nativeArchiveFixture(db, harness.cipher, {
    chain: 3,
    selected: "all",
    publicationAgeDays: 8,
    withArchiveSubtitles: true,
  });
  directories.push(f.file.directory);
  await f.prepare();
  await f.apply();
  // Household's actual declaration/release producer is covered separately; this test isolates repeated physical restore.
  await db.recoveryHold.updateMany({
    where: { mediaId: f.file.media.id },
    data: { releasedAt: new Date(), releasedById: f.prior.actor.id },
  });
  await db.mediaIntent.updateMany({
    where: { mediaId: f.file.media.id },
    data: { automationEpoch: 1, desiredPresence: true },
  });
  const cleanup = f.cleanups.find((item) => item.id !== f.first.id);
  if (cleanup === undefined) throw new Error("Intermediate archive missing");
  const continuation =
    await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
      where: { originalCleanupId: cleanup.id },
    });
  const opId = z.uuid().parse(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: continuation.id,
        expectedVersion: continuation.version,
      }),
    ),
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: opId },
  });
  const cleanupInput = CleanupNativeArchiveInputSchema.parse(operation.payload);
  await observeArchiveCleanup(f.observerContext, cleanupInput);
  expect(
    await createNativeArchiveFileActivities(
      f.context,
      f.execution,
    ).cleanupNativeArchiveFiles(cleanupInput),
  ).toEqual({ status: "cleaned" });
  const absent = await db.libraryAsset.findUniqueOrThrow({
    where: { id: cleanup.assetId },
  });
  const historical = await db.upgradeCleanup.findMany({
    orderBy: { id: "asc" },
  });
  const recoveryId = crypto.randomUUID();
  await prepareMediaRestore(db, {
    recoveryId,
    expectedEpoch: 1,
    reason: "Second archive backup restore",
  });
  const proofs = await grantTestExclusionProofs(db, f.prior.actor.id);
  for (const proof of proofs) {
    const roots =
      f.context.files.roots[
        proof.libraryRoot === "/data/movies" ? "movies" : "tv"
      ];
    await writeFile(
      path.join(roots.library, ".plexignore"),
      proof.rootMarkerAfter,
    );
    await writeFile(
      path.join(roots.control, ".plexignore"),
      proof.controlMarkerAfter,
    );
  }
  const restore = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `restore-observe:${recoveryId}` },
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const command = await f.service.prepare(f.prior.actor, crypto.randomUUID(), {
    restoreOperationId: restore.id,
    recoveryEpoch: 2,
    runtimeVersion: runtime.version,
    activation: "activate",
    cleanupIds: [f.first.id],
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
  const scope = NativeArchiveScopeSchema.parse(plan.scope);
  expect(scope.files.map((file) => file.assetId)).not.toContain(absent.id);
  expect(scope.terminalDependencies).toHaveLength(1);
  expect(scope.terminalDependencies[0]?.kind).toBe("archive_completion");
  const approval = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    planId,
    {
      expectedVersion: plan.version,
      planHash: z.string().parse(plan.planHash),
      recoveryEpoch: 2,
      runtimeVersion: runtime.version,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  const applyInput = {
    planId,
    operationId: z.uuid().parse(approval.operationId),
    planHash: z.string().parse(plan.planHash),
  };
  await observe(applyInput);
  await applyPreparedNativeArchive(
    f.context,
    applyInput,
    await prepareNativeArchiveFiles(f.context, applyInput),
  );
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: absent.id } }),
  ).toEqual(absent);
  expect(await db.upgradeCleanup.findMany({ orderBy: { id: "asc" } })).toEqual(
    historical,
  );
  expect(
    await db.nativeArchiveCleanupContinuation.count({
      where: { recoveryEpoch: 2, originalCleanupId: cleanup.id },
    }),
  ).toBe(0);
});
