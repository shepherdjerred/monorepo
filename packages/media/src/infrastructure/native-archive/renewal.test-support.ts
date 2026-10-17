import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { createNativeArchiveFileActivities } from "#automation/native-archive/activities.ts";
import { createNativeArchiveObserver } from "#migration/native-archive/producer.ts";
import { createNativeArchiveCleanupObserver } from "#migration/native-archive/cleanup.ts";
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
  const observe = createNativeArchiveObserver(f.observerContext);
  await observe(input.planId);
  await files.prepareNativeArchiveFiles(input);
  return { input, files, observe };
}
export async function approveArchiveRenewal(
  db: Database,
  f: ArchiveTransitionFixture,
  prepared: Awaited<ReturnType<typeof prepareArchiveRenewal>>,
) {
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
  await prepared.observe(plan.id);
  const input = {
    planId: plan.id,
    operationId: z.uuid().parse(approval.operationId),
    planHash: z.string().parse(plan.planHash),
  };
  await prepared.files.applyNativeArchiveFiles(input);
  await prepared.files.applyNativeArchiveFiles(input);
  return plan.id;
}
export async function cleanRenewedArchive(
  db: Database,
  f: ArchiveTransitionFixture,
  planId: string,
  originalCleanupId: string,
) {
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
  await createNativeArchiveCleanupObserver(f.observerContext)(input);
  const files = createNativeArchiveFileActivities(f.context, f.execution);
  const result = await files.cleanupNativeArchiveFiles(input);
  const replay = await files.cleanupNativeArchiveFiles(input);
  return { result, replay, row };
}
