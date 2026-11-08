import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { ApprovedStorageRoot } from "#shared/canonical-storage.ts";
import type { PrepareNativeCompensation } from "#shared/native-recovery/compensation.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import { assertNativeRestore } from "#infrastructure/native-recovery/scope.ts";
import { resolveNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { nativeHousehold } from "#infrastructure/native-recovery/snapshots.ts";
import { nativeAttempt } from "#infrastructure/native-recovery/snapshots.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import {
  archiveMedia,
  archiveTorrents,
} from "#infrastructure/native-archive/snapshots.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { loadSeriesPackNativeParentsV1 } from "./parents.ts";
import {
  captureSeriesPackInterruptedV1,
  seriesPackInterruptedLifecycleV1,
} from "./interrupted.ts";

/** Caller holds lockSeriesPackNativeScopeV1's complete current row set. */
export async function buildSeriesPackNativeScopeV1(
  tx: Prisma.TransactionClient,
  input: PrepareNativeCompensation,
  budget: PublicationAuthorityReadBudget,
  reviewedStorageRoots?: ApprovedStorageRoot[],
) {
  await assertNativeRestore(tx, { ...input, assetIds: [] }, budget);
  const locator = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: input.transitionId },
    select: { attemptId: true },
  });
  budget.consume(1);
  const graph = await loadSeriesPackNativeParentsV1(
    tx,
    locator.attemptId,
    budget,
  );
  const publication = graph.publication.reference;
  if (
    publication.transitionId !== input.transitionId ||
    publication.intent.birthEpoch >= input.recoveryEpoch
  )
    throw new NativeCompensationProtection(
      "compensation_whole_transition_unavailable",
    );
  const earlier = await tx.nativePublicationCompensationContinuation.findMany({
    where: { transitionId: publication.transitionId },
    select: { id: true },
    orderBy: { recoveryEpoch: "desc" },
    take: budget.take,
  });
  budget.consume(earlier.length);
  // First native journey only. Never pretend a previous recovery body is v1.
  if (earlier.length > 0)
    throw new NativeCompensationProtection(
      "series_pack_previous_compensation_requires_review",
    );
  await tx.$queryRaw`SELECT media_series_pack_native_before_v1(${z.json().parse(publication.intent)}::jsonb,${input.recoveryEpoch})::text`;
  const interruptedWork = await captureSeriesPackInterruptedV1(tx, graph);
  const files = publication.intent.entries.map((item) => {
    const before = item.predecessor;
    if (before === null) throw new Error("Native pack predecessor missing");
    return {
      assetId: before.id,
      assetVersion: before.version,
      canonicalPath: before.path,
      libraryKind: "tv" as const,
      checksum: before.checksum,
      sizeBytes: before.sizeBytes,
      ownershipEpoch: before.ownershipEpoch,
      properties: before.properties,
      mediaIds: before.coverage
        .filter((row) => row.current)
        .map((row) => row.mediaId),
      subtitles: before.subtitles,
    };
  });
  const media = await archiveMedia(tx, publication.intent.mediaIds);
  const ancestors = media.flatMap((row) =>
    [row.parent?.id, row.parent?.parent?.id].filter((id) => id !== undefined),
  );
  const assetIds = publication.intent.entries.flatMap((item) => [
    item.entry.assetId,
    ...(item.predecessor === null ? [] : [item.predecessor.id]),
  ]);
  const scope = SeriesPackNativeCompensationScopeV3Schema.parse({
    schemaVersion: 3,
    lifecycleKind: "publication_compensation",
    protocol: "series_pack_publication_v3",
    request: input,
    publication,
    transition: {
      transitionId: publication.transitionId,
      intentHash: publication.intentHash,
      attemptId: publication.intent.attemptId,
      birthEpoch: publication.intent.birthEpoch,
      filePlanHash: publication.intent.filePlanHash,
    },
    interruptedWork,
    interruptedAttemptRaw: canonicalJson(
      nativeAttempt(graph.publication.attempt),
    ),
    forwardParents: graph.forward.map((row) => ({
      operationId: row.operationId,
      batchIndex: row.command.batchIndex,
      commandHash: row.commandHash,
      completionHash: row.completionHash,
    })),
    previousCompensation: null,
    requiredAbsences: publication.intent.entries.flatMap((item) =>
      item.participants
        .filter((row) => row.physical.root === "control")
        .map((row) => ({
          assetId: row.assetId,
          libraryKind: "tv",
          canonicalPath: `/data/tv/.media-control/${row.physical.path}`,
        })),
    ),
    files,
    media,
    storageRoots: await resolveNativeStorageRoots(
      tx,
      budget,
      reviewedStorageRoots,
    ),
    household: await nativeHousehold(
      tx,
      publication.intent.mediaIds,
      ancestors,
    ),
    lifecycle: await seriesPackInterruptedLifecycleV1(
      tx,
      graph,
      interruptedWork,
    ),
    torrents: await archiveTorrents(tx, assetIds),
  });
  return { transaction: tx, budget, scope, graph };
}
