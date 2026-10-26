import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import {
  archiveReviewObserver,
  observeArchiveCleanup,
} from "#automation/native-archive/fixtures/observe.ts";
import { CleanupNativeArchiveInputSchema } from "#shared/native-recovery/archive.ts";
import type { archivePublicationTransitionFixture } from "./publication-transition.test-support.ts";
import { queueNativeArchiveCleanup } from "./continuation.ts";

export type ArchiveTransitionFixture = Awaited<
  ReturnType<typeof archivePublicationTransitionFixture>
>;
export async function prepareArchiveRenewal(
  db: Database,
  f: ArchiveTransitionFixture,
  cleanupIds: string[],
) {
  f.traceStage("review.command");
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const command = await f.service.prepare(f.prior.actor, crypto.randomUUID(), {
    restoreOperationId: f.restore.id,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    activation: runtime.mode === "observe" ? "activate" : "extend",
    cleanupIds,
  });
  const input = {
    planId: z.uuid().parse(command.nativeRecoveryId),
    operationId: z.uuid().parse(command.operationId),
  };
  const files = createNativeArchiveFileActivities(f.context, f.execution);
  const observe = archiveReviewObserver(f.observerContext);
  f.traceStage("review.network");
  await observe(input);
  f.traceStage("review.files");
  await files.prepareNativeArchiveFiles(input);
  return { input, files, observe };
}
export async function approveArchiveRenewal(
  db: Database,
  f: ArchiveTransitionFixture,
  prepared: Awaited<ReturnType<typeof prepareArchiveRenewal>>,
) {
  f.traceStage("apply.command");
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: prepared.input.planId },
  });
  const approval = await f.service.apply(
    f.prior.actor,
    crypto.randomUUID(),
    plan.id,
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
    planId: plan.id,
    operationId: z.uuid().parse(approval.operationId),
    planHash: z.string().parse(plan.planHash),
  };
  f.traceStage("apply.network");
  await prepared.observe(input);
  f.traceStage("apply.files");
  await prepared.files.applyNativeArchiveFiles(input);
  f.traceStage("apply.ack");
  await prepared.files.applyNativeArchiveFiles(input);
  f.traceStage("assertions");
  return plan.id;
}
export async function cleanRenewedArchive(
  db: Database,
  f: ArchiveTransitionFixture,
  planId: string,
  originalCleanupId: string,
) {
  f.traceStage("cleanup.queue");
  const row = await db.nativeArchiveCleanupContinuation.findFirstOrThrow({
    where: { receipt: { planId }, originalCleanupId },
  });
  const id = z.uuid().parse(
    await db.$transaction((tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: row.id,
        expectedVersion: row.version,
      }),
    ),
  );
  const operation = await db.operation.findUniqueOrThrow({ where: { id } });
  const input = CleanupNativeArchiveInputSchema.parse(operation.payload);
  f.traceStage("cleanup.network");
  await observeArchiveCleanup(f.observerContext, input);
  const files = createNativeArchiveFileActivities(f.context, f.execution);
  f.traceStage("cleanup.files");
  const result = await files.cleanupNativeArchiveFiles(input);
  f.traceStage("cleanup.ack");
  const replay = await files.cleanupNativeArchiveFiles(input);
  f.traceStage("assertions");
  return { result, replay, row };
}
