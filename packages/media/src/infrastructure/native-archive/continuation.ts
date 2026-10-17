import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveContinuationSchema,
  CleanupNativeArchiveInputSchema,
  type CleanupNativeArchiveInput,
} from "#shared/native-recovery/archive.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { queueOperation } from "#automation/store.ts";
import {
  recordsAuthorized,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { lockNativeArchiveScope } from "./guards.ts";
import { resolveArchiveBindings } from "./bindings.ts";

export class NativeArchiveProtection extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NativeArchiveProtection";
  }
}
export async function queueNativeArchiveCleanup(
  tx: Prisma.TransactionClient,
  input: {
    continuationId: string;
    expectedVersion: number;
    scanId?: string;
    previousWorkflowClosed?: {
      operationId: string;
      workflowId: string;
      status: "COMPLETED" | "FAILED" | "CANCELLED" | "TERMINATED" | "TIMED_OUT";
    };
  },
): Promise<string | null> {
  const initial = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
  });
  const descriptor = NativeArchiveContinuationSchema.parse(initial.descriptor);
  await lockNativeArchiveScope(tx, descriptor.scope);
  const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
    include: { receipt: true },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    row.version !== input.expectedVersion ||
    row.state === "cleaned" ||
    row.recoveryEpoch !== runtime.recoveryEpoch
  )
    return null;
  if (row.coordinatorOperationId !== null) {
    const previous = await tx.operation.findUniqueOrThrow({
      where: { id: row.coordinatorOperationId },
    });
    const proof = input.previousWorkflowClosed;
    const closed =
      proof?.operationId === previous.id &&
      proof.workflowId === `media-operation-${previous.id}` &&
      ["COMPLETED", "FAILED", "CANCELLED", "TERMINATED", "TIMED_OUT"].includes(
        proof.status,
      );
    if (!closed) return null;
  }
  const intents = await tx.mediaIntent.findMany({
    where: {
      edition: "default",
      mediaId: { in: descriptor.scope.media.map((item) => item.id) },
    },
    orderBy: { mediaId: "asc" },
  });
  const generations = Object.fromEntries(
    intents.map((item) => [item.mediaId, item.generation]),
  );
  const operationId = await queueOperation(tx, {
    key: `native-archive-cleanup:${row.id}:${String(row.version)}:${input.scanId ?? "due"}`,
    kind: "cleanup_native_archive",
    targetId: row.id,
    userId: row.receipt.actorId,
    payload: { schemaVersion: 1, continuationId: row.id, generations },
  });
  await tx.nativeArchiveCleanupContinuation.update({
    where: { id: row.id },
    data: {
      state: "cleaning",
      coordinatorOperationId: operationId,
      version: { increment: 1 },
    },
  });
  return operationId;
}
export async function assertNativeArchiveCleanup(
  tx: Prisma.TransactionClient,
  input: CleanupNativeArchiveInput,
) {
  const initial = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
  });
  const descriptor = NativeArchiveContinuationSchema.parse(initial.descriptor);
  await lockNativeArchiveScope(tx, descriptor.scope);
  const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: input.continuationId },
    include: { receipt: { include: { plan: true } } },
  });
  if (
    row.coordinatorOperationId !== input.operationId ||
    row.recoveryEpoch !== input.recoveryEpoch ||
    !["cleaning", "protected"].includes(row.state) ||
    snapshotHash(z.json().parse(row.descriptor)) !== row.descriptorHash ||
    snapshotHash(z.json().parse(descriptor)) !== row.descriptorHash
  )
    throw new NativeArchiveProtection("archive_coordinator_changed");
  const receipt = row.receipt;
  if (
    receipt.plan.state !== "applied" ||
    receipt.planHash !== receipt.plan.planHash ||
    snapshotHash(z.json().parse(receipt.plan.plan)) !== receipt.planHash ||
    receipt.recoveryEpoch !== row.recoveryEpoch
  )
    throw new Error("Archive continuation receipt is inconsistent");
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  if (
    operation.kind !== "cleanup_native_archive" ||
    operation.targetId !== row.id ||
    snapshotHash(CleanupNativeArchiveInputSchema.parse(operation.payload)) !==
      snapshotHash(input)
  )
    throw new NativeArchiveProtection("archive_operation_changed");
  await assertCleanupOwner(tx, receipt.actorId);
  const runtime = await runtimeAuthority(tx);
  if (!runtime.active || runtime.epoch !== row.recoveryEpoch)
    throw new NativeArchiveProtection("archive_runtime_protected");
  const ids = descriptor.scope.media.map((item) => item.id);
  await assertLegacyClaimsResolved(tx, ids);
  await assertNativeExclusion(tx);
  // A valid newly reserved candidate must protect before strict historical
  // subtitle snapshot parsing; all reviewed participant rows are already locked.
  const reviewedAssetIds = descriptor.scope.files.map((file) => file.assetId);
  await assertCleanupReplacement(tx, reviewedAssetIds);
  const effective = await resolveArchiveBindings(tx, receipt, descriptor);
  const assetIds = effective.networkScope.files.map((file) => file.assetId);
  const additionalAssetIds = assetIds.filter(
    (id) => !reviewedAssetIds.includes(id),
  );
  if (additionalAssetIds.length > 0)
    await assertCleanupReplacement(tx, additionalAssetIds);
  if (
    !(await recordsAuthorized(tx, {
      epoch: row.recoveryEpoch,
      mediaIds: ids,
      assetIds,
    }))
  )
    throw new NativeArchiveProtection(
      "archive_current_record_authority_required",
    );
  const generations = await assertCleanupEligibility(tx, descriptor, input);
  return {
    row,
    descriptor,
    ...effective,
    generations,
    currentGenerations: generations,
  };
}

async function assertCleanupOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  try {
    await assertNativeOwner(tx, actorId);
  } catch (error) {
    if (error instanceof MediaError && error.code === "forbidden")
      throw new NativeArchiveProtection("archive_owner_changed");
    throw error;
  }
}

async function assertCleanupReplacement(
  tx: Prisma.TransactionClient,
  assetIds: string[],
) {
  try {
    await assertNoSubtitleReplacement(tx, assetIds);
  } catch (error) {
    if (
      error instanceof FileGuardError &&
      error.reason === "subtitle_replacement_unsettled"
    )
      throw new NativeArchiveProtection(
        "archive_subtitle_replacement_unsettled",
      );
    throw error;
  }
}

async function assertCleanupEligibility(
  tx: Prisma.TransactionClient,
  descriptor: z.infer<typeof NativeArchiveContinuationSchema>,
  input: CleanupNativeArchiveInput,
) {
  const ids = descriptor.scope.media.map((item) => item.id);
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: ids } },
    orderBy: { mediaId: "asc" },
  });
  const generations = Object.fromEntries(
    intents.map((item) => [item.mediaId, item.generation]),
  );
  if (
    intents.length !== ids.length ||
    snapshotHash(generations) !== snapshotHash(input.generations)
  )
    throw new NativeArchiveProtection("archive_generation_changed");
  if (
    await tx.recoveryHold.count({
      where: { edition: "default", mediaId: { in: ids }, releasedAt: null },
    })
  )
    throw new NativeArchiveProtection(
      "archive_household_reconciliation_required",
    );
  if (
    await tx.retentionHold.count({
      where: {
        edition: "default",
        mediaId: { in: ids },
        OR: [{ isPin: true }, { until: null }, { until: { gt: new Date() } }],
      },
    })
  )
    throw new NativeArchiveProtection("archive_media_held");
  const edge = descriptor.scope.edges.find(
    (item) => item.id === descriptor.selectedCleanupId && item.selected,
  );
  if (edge === undefined)
    throw new Error("Archive selected cleanup descriptor missing");
  if (Date.parse(edge.expiresAt) > Date.now())
    throw new NativeArchiveProtection("archive_rollback_window_incomplete");
  if (
    await tx.acquisitionReservation.count({
      where: { mediaId: { in: ids }, edition: "default" },
    })
  )
    throw new NativeArchiveProtection("archive_acquisition_in_progress");
  if (
    await tx.retentionDecision.count({
      where: {
        edition: "default",
        mediaId: { in: ids },
        state: { in: ["quarantined", "purging", "restoring"] },
      },
    })
  )
    throw new NativeArchiveProtection("archive_recovery_reference_active");
  return generations;
}
