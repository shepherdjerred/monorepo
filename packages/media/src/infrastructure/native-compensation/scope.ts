import type { PublicationIntent } from "#shared/publication-proof/intent.ts";
import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeCompensationScopeSchema,
  type PrepareNativeCompensation,
} from "#shared/native-recovery/compensation.ts";
import { assertNativeRestore } from "#infrastructure/native-recovery/scope.ts";
import {
  nativeHousehold,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { resolveNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
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

export async function buildNativeCompensationScope(
  tx: Prisma.TransactionClient,
  input: PrepareNativeCompensation,
) {
  await assertNativeRestore(tx, { ...input, assetIds: [] });
  const transition = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: input.transitionId },
  });
  const reference = await loadPublicationIntent(tx, transition.attemptId);
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
    take: 101,
  });
  if (earlier.length > 100)
    throw new NativeCompensationProtection("compensation_history_bound");
  if (earlier.some((row) => row.recoveryEpoch >= input.recoveryEpoch))
    throw new NativeCompensationProtection(
      "compensation_current_authority_already_exists",
    );
  const previous = earlier[0];
  await assertPreviousPublication(tx, previous);
  if (previous?.coordinatorOperationId === null)
    throw new NativeCompensationProtection(
      "compensation_previous_coordinator_missing",
    );
  const priorChain =
    previous === undefined ? [] : await compensationAncestors(tx, previous.id);
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
  return NativeCompensationScopeSchema.parse({
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
    storageRoots: await resolveNativeStorageRoots(tx),
    household: await nativeHousehold(tx, ids, ancestors),
    lifecycle: await nativeCompensationLifecycle(tx, {
      mediaIds: ids,
      assetIds,
      interrupted: interruptedWork,
    }),
    torrents: await archiveTorrents(tx, assetIds),
  });
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
) {
  if (previous?.fenceRelease != null) {
    if (
      previous.publicationCoordinatorOperationId === null ||
      (await readVerifiedCompensationPublication(tx, {
        schemaVersion: 1,
        continuationId: previous.id,
        operationId: previous.publicationCoordinatorOperationId,
        recoveryEpoch: previous.recoveryEpoch,
      })) === null
    )
      throw new Error(
        "Released latest compensation has no verified publication",
      );
    throw new NativeCompensationProtection(
      "compensation_already_published_use_native_recovery",
    );
  }
}
