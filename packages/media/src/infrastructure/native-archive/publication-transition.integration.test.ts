import { afterAll, beforeEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import {
  archiveReviewObserver,
  observeArchiveCleanup,
} from "#automation/native-archive/fixtures/observe.ts";
import {
  NativeArchiveScopeSchema,
  CleanupNativeArchiveInputSchema,
} from "#shared/native-recovery/archive.ts";
import {
  archivePublicationTransitionFixture,
  type ArchiveDiagnosticStage,
} from "./publication-transition.test-support.ts";
import { queueNativeArchiveCleanup } from "./continuation.ts";
import { traceArchiveReadBudget } from "./tests/read-budget-trace.test-support.ts";

const harness = automationTestHarness();
traceArchiveReadBudget("archive-publication-read-diagnostic");
const directories: string[] = [];
let fixture:
  Awaited<ReturnType<typeof archivePublicationTransitionFixture>> | undefined;
beforeEach(async (context) => {
  const stages: ArchiveDiagnosticStage[] = [];
  context.onTestFinished(() => {
    if (context.task.result?.state === "fail")
      console.warn(
        "archive-publication-stage-diagnostic",
        JSON.stringify({ stages }),
      );
  });
  fixture = await archivePublicationTransitionFixture(
    harness.database(),
    harness.context().cipher,
    harness.context(),
    {
      traceStage: (stage) => {
        stages.push(stage);
      },
    },
  );
  directories.push(fixture.file.directory);
});
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("actual C→D publication replaces only terminal no-effect A authority before exact A cleanup", async () => {
  if (fixture === undefined)
    throw new Error("Actual adjacent transition setup missing");
  const f = fixture;
  const db = harness.database();
  f.traceStage("assertions");
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: f.acquired.attempt.id },
  });
  expect(transition.outcome).not.toBeNull();
  const current = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.entry.assetId },
  });
  expect(current.plexPublishedAt).not.toBeNull();
  if (current.plexPublishedAt === null || f.entry.previousAssetId === null)
    throw new Error("Actual adjacent verified publication missing");
  const predecessor = await db.libraryAsset.findUniqueOrThrow({
    where: { id: f.entry.previousAssetId },
  });
  expect(predecessor.rollbackExpiresAt?.getTime()).toBe(
    current.plexPublishedAt.getTime() + 7 * 86_400_000,
  );
  const newCleanup = await db.upgradeCleanup.findUniqueOrThrow({
    where: {
      assetId_successorAssetId: {
        assetId: predecessor.id,
        successorAssetId: current.id,
      },
    },
  });
  expect(newCleanup.expiresAt).toEqual(predecessor.rollbackExpiresAt);
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  f.traceStage("review.command");
  const command = await f.service.prepare(f.prior.actor, crypto.randomUUID(), {
    restoreOperationId: f.restore.id,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    activation: "extend",
    cleanupIds: [f.first.id],
  });
  const planId = z.uuid().parse(command.nativeRecoveryId);
  const prepareInput = {
    planId,
    operationId: z.uuid().parse(command.operationId),
  };
  const files = createNativeArchiveFileActivities(f.context, f.execution);
  const observe = archiveReviewObserver(f.observerContext);
  f.traceStage("review.network");
  await observe(prepareInput);
  f.traceStage("review.files");
  await files.prepareNativeArchiveFiles(prepareInput);
  f.traceStage("assertions");
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const scope = NativeArchiveScopeSchema.parse(plan.scope);
  expect(scope.files).toHaveLength(4);
  expect(
    scope.files.find((file) => file.assetId === f.entry.assetId)?.authority
      .kind,
  ).toBe("publication_transition_binding");
  expect(scope.supersessions?.map((item) => item.continuationId)).toEqual([
    f.oldContinuation.id,
  ]);
  f.traceStage("apply.command");
  const approval = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    planId,
    {
      expectedVersion: plan.version,
      planHash: z.string().parse(plan.planHash),
      recoveryEpoch: runtime.recoveryEpoch,
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
  f.traceStage("apply.network");
  await observe(applyInput);
  f.traceStage("apply.files");
  await files.applyNativeArchiveFiles(applyInput);
  f.traceStage("apply.ack");
  await files.applyNativeArchiveFiles(applyInput);
  f.traceStage("assertions");
  expect(
    await db.recoveryHold.count({
      where: { mediaId: f.file.media.id, releasedAt: null },
    }),
  ).toBe(0);
  expect(
    await db.nativeRecoveryReceipt.findUniqueOrThrow({
      where: { id: f.oldReceipt.id },
    }),
  ).toEqual(f.oldReceipt);
  expect(
    await db.upgradeCleanup.findMany({
      where: { id: { in: f.oldCleanups.map((row) => row.id) } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(f.oldCleanups);
  const old = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: f.oldContinuation.id },
  });
  expect(old.state).toBe("superseded");
  expect(old.descriptor).toEqual(f.oldContinuation.descriptor);
  expect(old.executionEvidence).toBeNull();
  expect(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: old.id,
        expectedVersion: old.version,
        previousWorkflowClosed: {
          operationId: z.uuid().parse(old.coordinatorOperationId),
          workflowId: `media-operation-${String(old.coordinatorOperationId)}`,
          status: "FAILED",
        },
      }),
    ),
  ).toBeNull();
  f.traceStage("cleanup.queue");
  const next = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
    where: { receipt: { planId }, originalCleanupId: f.first.id },
  });
  const operationId = z.uuid().parse(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: next.id,
        expectedVersion: next.version,
      }),
    ),
  );
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  const cleanup = CleanupNativeArchiveInputSchema.parse(operation.payload);
  f.traceStage("cleanup.network");
  await observeArchiveCleanup(f.observerContext, cleanup);
  f.traceStage("cleanup.files");
  expect(await files.cleanupNativeArchiveFiles(cleanup)).toEqual({
    status: "cleaned",
  });
  f.traceStage("cleanup.ack");
  expect(await files.cleanupNativeArchiveFiles(cleanup)).toEqual({
    status: "cleaned",
  });
  f.traceStage("assertions");
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: current.id } }),
  ).toEqual(current);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: transition.id },
    }),
  ).toEqual(transition);
});
