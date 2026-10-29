import type { PublicationIntent } from "#shared/publication-proof/intent.ts";
import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeCompensationScopeSchema,
  type NativeCompensationScope,
  type PrepareNativeCompensation,
} from "#shared/native-recovery/compensation.ts";
import { assertNativeRestore } from "#infrastructure/native-recovery/scope.ts";
import {
  nativeHousehold,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { resolveNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import type { ApprovedStorageRoot } from "#shared/canonical-storage.ts";
import {
  archiveMedia,
  archiveTorrents,
} from "#infrastructure/native-archive/snapshots.ts";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import {
  captureInterruptedPublicationWork,
  nativeCompensationLifecycle,
} from "#infrastructure/publication-proof/lifecycle.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { compensationAncestors } from "./records.ts";
import { publicationPhysicalSnapshot } from "#infrastructure/publication-proof/projection.ts";
import { readVerifiedCompensationPublication } from "./publication-receipt.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function buildNativeCompensationScope(
  tx: Prisma.TransactionClient,
  input: PrepareNativeCompensation,
  budget = new PublicationAuthorityReadBudget(),
  reviewedStorageRoots?: ApprovedStorageRoot[],
) {
  const projection = await buildNativeCompensationScopeProjection(
    tx,
    input,
    budget,
    reviewedStorageRoots,
  );
  return projection.scope;
}

/** Actual queried ancestry retained only for its caller's same transaction/snapshot. */
export async function buildNativeCompensationScopeProjection(
  tx: Prisma.TransactionClient,
  input: PrepareNativeCompensation,
  budget: PublicationAuthorityReadBudget,
  reviewedStorageRoots?: ApprovedStorageRoot[],
) {
  await assertNativeRestore(tx, { ...input, assetIds: [] }, budget);
  const transition = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: input.transitionId },
  });
  budget.consume(1);
  const reference = await loadPublicationIntent(
    tx,
    transition.attemptId,
    budget,
  );
  if (reference === null)
    throw new Error("Compensation publication intent missing");
  const intent = reference.intent;
  const ids = [...intent.mediaIds].sort();
  const assetIds = [
    ...new Set(
      intent.entries.flatMap(({ entry }) => [
        entry.assetId,
        ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
      ]),
    ),
  ].sort();
  if (assetIds.length > 25)
    throw new NativeCompensationProtection("compensation_scope_exceeds_limit");
  if (transition.outcome !== null)
    throw new NativeCompensationProtection(
      "compensation_transition_already_committed",
    );
  if (
    intent.entries.some((item) => item.predecessor === null) ||
    intent.birthEpoch >= input.recoveryEpoch
  )
    throw new NativeCompensationProtection(
      "compensation_whole_transition_unavailable",
    );
  await assertNoSubtitleReplacement(tx, assetIds);
  const earlier = await tx.nativePublicationCompensationContinuation.findMany({
    where: { transitionId: transition.id },
    orderBy: { recoveryEpoch: "desc" },
    take: budget.take,
  });
  budget.consume(earlier.length);
  if (earlier.length > 100)
    throw new NativeCompensationProtection("compensation_history_bound");
  if (earlier.some((row) => row.recoveryEpoch >= input.recoveryEpoch))
    throw new NativeCompensationProtection(
      "compensation_current_authority_already_exists",
    );
  const previous = earlier[0];
  await assertPreviousPublication(tx, previous, budget);
  if (previous?.coordinatorOperationId === null)
    throw new NativeCompensationProtection(
      "compensation_previous_coordinator_missing",
    );
  const priorChain =
    previous === undefined
      ? []
      : await compensationAncestors(tx, previous.id, budget);
  const files = await predecessorFiles(tx, intent, {
    recoveryEpoch: input.recoveryEpoch,
    priorChain,
  });
  if (
    await tx.libraryAsset.count({
      where: { id: { in: intent.entries.map((item) => item.entry.assetId) } },
    })
  )
    throw new NativeCompensationProtection(
      "compensation_successor_database_state_present",
    );
  if (
    await tx.assetCoverage.count({
      where: {
        edition: "default",
        mediaId: { in: ids },
        current: true,
        assetId: { notIn: files.map((row) => row.assetId) },
      },
    })
  )
    throw new NativeCompensationProtection(
      "compensation_current_coverage_changed",
    );
  const media = await archiveMedia(tx, ids);
  const interruptedWork = await captureInterruptedPublicationWork(
    tx,
    transition.id,
    budget,
  );
  const ancestors = media.flatMap((row) =>
    [row.parent?.id, row.parent?.parent?.id].filter((id) => id !== undefined),
  );
  const requiredAbsences = intent.entries.flatMap((item) =>
    item.participants
      .filter((participant) => participant.physical.root === "control")
      .map((participant) => ({
        assetId: participant.assetId,
        libraryKind: participant.libraryKind,
        canonicalPath: `/data/${participant.libraryKind}/.media-control/${participant.physical.path}`,
      })),
  );
  const scope = NativeCompensationScopeSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "publication_compensation",
    request: input,
    transition: {
      transitionId: transition.id,
      intentHash: reference.intentHash,
      attemptId: intent.attemptId,
      birthEpoch: intent.birthEpoch,
      filePlanHash: intent.filePlanHash,
    },
    intent,
    interruptedWork,
    entries: intent.entries,
    previousCompensation:
      previous === undefined
        ? null
        : {
            continuationId: previous.id,
            descriptorHash: previous.descriptorHash,
            coordinatorOperationId: previous.coordinatorOperationId,
            executionHash:
              previous.executionEvidence === null
                ? null
                : snapshotHash(nativeJson(previous.executionEvidence)),
          },
    requiredAbsences,
    files,
    media,
    storageRoots: await resolveNativeStorageRoots(
      tx,
      budget,
      reviewedStorageRoots,
    ),
    household: await nativeHousehold(tx, ids, ancestors),
    lifecycle: await nativeCompensationLifecycle(
      tx,
      {
        mediaIds: ids,
        assetIds,
        interrupted: interruptedWork,
      },
      budget,
    ),
    torrents: await archiveTorrents(tx, assetIds),
  });
  return {
    transaction: tx,
    budget,
    scope,
    priorChain,
    rawHash: scopeProjectionHash(scope, priorChain),
  };
}

export type CompensationScopeProjection = Awaited<
  ReturnType<typeof buildNativeCompensationScopeProjection>
>;

/** A final writer may project the already validated prefix, never adopt an earlier TX's chain. */
export function compensationPreviousEffects(
  tx: Prisma.TransactionClient,
  scope: NativeCompensationScope,
  projection: CompensationScopeProjection,
  budget: PublicationAuthorityReadBudget,
) {
  if (
    projection.transaction !== tx ||
    projection.budget !== budget ||
    snapshotHash(nativeJson(scope)) !==
      snapshotHash(nativeJson(projection.scope)) ||
    projection.rawHash !==
      scopeProjectionHash(projection.scope, projection.priorChain)
  )
    throw new Error(
      "Compensation scope projection changed or belongs to another transaction/budget",
    );
  const previous = scope.previousCompensation;
  const record = projection.priorChain[0];
  if (previous === null) {
    if (record !== undefined)
      throw new Error("Compensation scope projection has unexpected ancestry");
    return [];
  }
  if (
    record?.row.id !== previous.continuationId ||
    record.row.descriptorHash !== previous.descriptorHash ||
    record.row.coordinatorOperationId !== previous.coordinatorOperationId ||
    record.row.transitionId !== scope.transition.transitionId ||
    (record.row.executionEvidence === null
      ? null
      : snapshotHash(nativeJson(record.row.executionEvidence))) !==
      previous.executionHash
  )
    throw new Error("Compensation scope projection prior prefix changed");
  return record.descriptor.approvedFileEvidence.acknowledgedEffects;
}

function scopeProjectionHash(
  scope: NativeCompensationScope,
  priorChain: Awaited<ReturnType<typeof compensationAncestors>>,
) {
  return snapshotHash(
    nativeJson({
      scope,
      chain: priorChain.map(
        ({ row, descriptor, selection, execution, completion, original }) => ({
          row,
          descriptor,
          selection,
          execution,
          completion,
          original,
        }),
      ),
    }),
  );
}

async function predecessorFiles(
  tx: Prisma.TransactionClient,
  intent: PublicationIntent,
  input: {
    recoveryEpoch: number;
    priorChain: Awaited<ReturnType<typeof compensationAncestors>>;
  },
) {
  const { priorChain } = input;
  const files = [];
  for (const item of intent.entries) {
    const before = item.predecessor;
    if (before === null) throw new Error("Compensation predecessor missing");
    await assertDefaultPhysicalAsset(tx, before.id);
    const current = await snapshotPublicationAsset(tx, before.id);
    if (
      current.state !== "published" ||
      current.coverage.some((row) => !row.current) ||
      current.checksum !== before.checksum ||
      current.path !== before.path ||
      current.ownershipEpoch >= input.recoveryEpoch ||
      snapshotHash(current.coverage) !== snapshotHash(before.coverage)
    )
      throw new NativeCompensationProtection(
        "compensation_restored_predecessor_changed",
      );
    const settled = priorChain
      .flatMap((record) => record.completion?.predecessorBindings ?? [])
      .find((binding) => binding.after.id === before.id);
    const expected = settled?.after ?? before;
    if (
      snapshotHash(nativeJson(publicationPhysicalSnapshot(current))) !==
      snapshotHash(nativeJson(publicationPhysicalSnapshot(expected)))
    )
      throw new NativeCompensationProtection(
        "compensation_predecessor_snapshot_changed",
      );
    if (
      current.subtitles.length > 100 ||
      current.subtitles.some((row) => row.state !== "installed")
    )
      throw new NativeCompensationProtection(
        "compensation_subtitle_scope_unavailable",
      );
    const relative = path.relative(
      `/data/${item.entry.libraryKind}`,
      current.path,
    );
    if (
      relative.length === 0 ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    )
      throw new NativeCompensationProtection(
        "compensation_path_outside_library",
      );
    files.push({
      assetId: current.id,
      assetVersion: current.version,
      canonicalPath: current.path,
      libraryKind: item.entry.libraryKind,
      checksum: current.checksum,
      sizeBytes: current.sizeBytes,
      ownershipEpoch: current.ownershipEpoch,
      properties: current.properties,
      mediaIds: current.coverage.map((row) => row.mediaId),
      subtitles: current.subtitles,
    });
  }
  return files;
}

async function assertPreviousPublication(
  tx: Prisma.TransactionClient,
  previous:
    | Prisma.NativePublicationCompensationContinuationGetPayload<
        Record<string, never>
      >
    | undefined,
  budget: PublicationAuthorityReadBudget,
) {
  if (previous?.fenceRelease != null) {
    if (
      previous.publicationCoordinatorOperationId === null ||
      (await readVerifiedCompensationPublication(
        tx,
        {
          schemaVersion: 1,
          continuationId: previous.id,
          operationId: previous.publicationCoordinatorOperationId,
          recoveryEpoch: previous.recoveryEpoch,
        },
        budget,
      )) === null
    )
      throw new Error(
        "Released latest compensation has no verified publication",
      );
    throw new NativeCompensationProtection(
      "compensation_already_published_use_native_recovery",
    );
  }
}
