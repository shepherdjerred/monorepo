import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { assertRuntime } from "#automation/files/guards.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  SubtitleReplacementSnapshotSchema,
  type SubtitleReplacementInput,
} from "#shared/subtitle-replacement.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  assertReplacementOwner,
  lockSubtitleReplacementScope,
} from "#infrastructure/subtitle-replacement/locks.ts";
import {
  captureReplacementSnapshot,
  replacementSubtitleSnapshot,
} from "./snapshot.ts";

export async function lockReplacement(
  tx: Prisma.TransactionClient,
  replacementId: string,
) {
  const initial = await tx.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
  });
  const scope = SubtitleReplacementSnapshotSchema.parse(initial.snapshot);
  await lockSubtitleReplacementScope(tx, {
    assetId: initial.assetId,
    mediaIds: scope.asset.coverage.map((item) => item.mediaId),
    replacementId,
  });
  const row = await tx.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { review: true, receipt: true },
  });
  if (
    snapshotHash(scope) !== row.snapshotHash ||
    row.recoveryEpoch !== scope.recoveryEpoch ||
    row.runtimeVersion !== scope.runtimeVersion
  )
    throw new FileGuardError("subtitle_replacement_snapshot_corrupt");
  return { row, scope };
}

export async function assertReplacementSnapshot(
  tx: Prisma.TransactionClient,
  replacementId: string,
  options: { allowCompensation?: boolean; actorId?: string } = {},
) {
  const row = await tx.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
  });
  const scope = SubtitleReplacementSnapshotSchema.parse(row.snapshot);
  await assertRuntime(tx, row.recoveryEpoch);
  await assertReplacementOwner(
    tx,
    options.allowCompensation === true && options.actorId !== undefined
      ? options.actorId
      : row.ownerId,
  );
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (!row.reservationActive || runtime.version !== scope.runtimeVersion)
    throw new FileGuardError("subtitle_replacement_authority_changed");
  if (options.allowCompensation !== true) {
    const current = await captureReplacementSnapshot(tx, {
      assetId: row.assetId,
      oldSubtitleId: row.oldSubtitleId,
      candidateSubtitleId: row.candidateSubtitleId,
      epoch: row.recoveryEpoch,
    });
    if (snapshotHash(current) !== row.snapshotHash)
      throw new FileGuardError("subtitle_replacement_snapshot_changed");
    return scope;
  }
  // A cancelled request cannot authorize new publication; it can settle only the
  // already journaled exact swap back to its unchanged prior binding.
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: row.assetId },
    include: { coverage: { where: { current: true } } },
  });
  const old = await tx.subtitleAsset.findUniqueOrThrow({
    where: { id: row.oldSubtitleId },
  });
  const candidate = await tx.subtitleAsset.findUniqueOrThrow({
    where: { id: row.candidateSubtitleId },
  });
  if (
    !asset.owned ||
    asset.state !== "published" ||
    asset.version !== scope.asset.version ||
    asset.checksum !== scope.asset.checksum ||
    asset.path !== scope.asset.path ||
    asset.ownershipEpoch !== scope.recoveryEpoch ||
    snapshotHash(asset.coverage.map((item) => item.mediaId).sort()) !==
      snapshotHash(scope.asset.coverage.map((item) => item.mediaId).sort()) ||
    snapshotHash(replacementSubtitleSnapshot(old)) !==
      snapshotHash(scope.old) ||
    snapshotHash(replacementSubtitleSnapshot(candidate)) !==
      snapshotHash(scope.candidate)
  )
    throw new FileGuardError("subtitle_replacement_compensation_changed");
  return scope;
}

export async function assertReplacementOperation(
  tx: Prisma.TransactionClient,
  input: SubtitleReplacementInput,
  kinds: readonly string[],
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const payload = z
    .object({ replacementId: z.literal(input.replacementId) })
    .safeParse(operation.payload);
  if (
    !payload.success ||
    !kinds.includes(operation.kind) ||
    operation.targetId !== input.replacementId
  )
    throw new FileGuardError("subtitle_replacement_operation_changed");
  if (operation.kind !== "cleanup_subtitle_replacement") {
    const row = await tx.subtitleReplacement.findUniqueOrThrow({
      where: { id: input.replacementId },
    });
    if (row.coordinatorOperationId !== operation.id)
      throw new FileGuardError("subtitle_replacement_coordinator_changed");
  }
  if (operation.userId !== null)
    await assertReplacementOwner(tx, operation.userId);
  else if (
    operation.kind !== "cleanup_subtitle_replacement" &&
    operation.kind !== "reconcile_subtitle_replacement"
  )
    throw new FileGuardError("subtitle_replacement_owner_missing");
  return operation.userId;
}
