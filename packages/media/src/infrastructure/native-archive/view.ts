import { archiveClosure } from "./closure.ts";
import { snapshotArchiveFile } from "./file-snapshot.ts";
import { NativeArchiveScopeProtection } from "./errors.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { NativeArchiveContinuationSchema } from "#shared/native-recovery/archive.ts";
import {
  NativeArchiveInventorySchema,
  NativeArchiveContinuationViewSchema,
  type NativeArchiveReasonSchema,
} from "#shared/native-recovery/archive-view.ts";
import type { z } from "zod";
import { MediaError } from "#application/errors.ts";
import { assertDefaultPhysicalAsset } from "#infrastructure/handoff/default-edition.ts";

export async function archiveInventory(
  tx: Prisma.TransactionClient,
  cursor: string | null,
) {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const restore = await tx.operation.findFirst({
    where: {
      kind: "restore_observe",
      status: "completed",
      result: { path: ["recoveryEpoch"], equals: runtime.recoveryEpoch },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = await tx.upgradeCleanup.findMany({
    where: {
      state: "pending",
      ...(cursor === null ? {} : { id: { gt: cursor } }),
    },
    include: {
      asset: {
        include: {
          coverage: { include: { media: true }, orderBy: { mediaId: "asc" } },
        },
      },
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  const cleanups = [];
  for (const row of rows.slice(0, 100)) {
    const reasons: z.infer<typeof NativeArchiveReasonSchema>[] = [];
    if (row.asset.state !== "superseded") reasons.push("archive_not_pending");
    if (
      row.asset.edition !== "default" ||
      row.asset.editionRootId === null ||
      row.asset.coverage.length === 0
    )
      reasons.push("archive_lineage_unresolved");
    if (row.asset.checksum === null) reasons.push("archive_checksum_missing");
    if (
      reasons.length === 0 &&
      !(await eligibleClosure(tx, row.id, runtime.recoveryEpoch))
    )
      reasons.push("archive_transition_reconciliation_required");
    if (
      await tx.nativeArchiveCleanupContinuation.count({
        where: {
          originalCleanupId: row.id,
          recoveryEpoch: runtime.recoveryEpoch,
        },
      })
    )
      reasons.push("archive_current_continuation_exists");
    cleanups.push({
      id: row.id,
      version: row.version,
      assetId: row.assetId,
      successorAssetId: row.successorAssetId,
      titles: row.asset.coverage.map((item) => item.media.title),
      mediaIds: row.asset.coverage.map((item) => item.mediaId),
      expiresAt: row.expiresAt.toISOString(),
      state: row.asset.state,
      sizeBytes: row.asset.sizeBytes.toString(),
      ownershipEpoch: row.asset.ownershipEpoch,
      reasons,
    });
  }
  return NativeArchiveInventorySchema.parse({
    nextCursor: rows.length > 100 ? rows[99]?.id : null,
    runtime: {
      mode: runtime.mode,
      recoveryEpoch: runtime.recoveryEpoch,
      version: runtime.version,
    },
    restoreOperationId: restore?.id ?? null,
    prerequisites:
      restore === null ? ["completed_restore_observation_required"] : [],
    cleanups,
  });
}
export async function archiveContinuationViews(
  tx: Prisma.TransactionClient,
  planId: string,
) {
  const rows = await tx.nativeArchiveCleanupContinuation.findMany({
    where: { receipt: { planId } },
    orderBy: { id: "asc" },
    take: 26,
  });
  if (rows.length > 25)
    throw new Error("Archive continuation count exceeds plan bound");
  const views = [];
  for (const row of rows) {
    const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
    const edge = descriptor.scope.edges.find(
      (item) => item.id === row.originalCleanupId && item.selected,
    );
    if (edge === undefined)
      throw new Error("Archive continuation selected edge missing");
    const mediaIds = edge.derivedPlan.mediaIds;
    const reasons: z.infer<typeof NativeArchiveReasonSchema>[] = [];
    if (row.state !== "cleaned") {
      if (
        await tx.recoveryHold.count({
          where: {
            edition: "default",
            mediaId: { in: mediaIds },
            releasedAt: null,
          },
        })
      )
        reasons.push("archive_household_reconciliation_required");
      if (
        await tx.retentionHold.count({
          where: {
            edition: "default",
            mediaId: { in: mediaIds },
            OR: [
              { isPin: true },
              { until: null },
              { until: { gt: new Date() } },
            ],
          },
        })
      )
        reasons.push("archive_media_held");
      if (
        await tx.libraryAsset.count({
          where: {
            id: {
              in: descriptor.scope.currentPlayback.map((item) => item.assetId),
            },
            state: { not: "published" },
          },
        })
      )
        reasons.push("archive_transition_reconciliation_required");
    }
    views.push(
      NativeArchiveContinuationViewSchema.parse({
        id: row.id,
        originalCleanupId: row.originalCleanupId,
        state: row.state,
        version: row.version,
        expiresAt: edge.expiresAt,
        titles: descriptor.scope.media
          .filter((item) => mediaIds.includes(item.id))
          .map((item) => item.title),
        reasons,
      }),
    );
  }
  return views;
}

async function eligibleClosure(
  tx: Prisma.TransactionClient,
  cleanupId: string,
  epoch: number,
) {
  try {
    const closure = await archiveClosure(tx, [cleanupId]);
    for (const asset of closure.assets) {
      await assertDefaultPhysicalAsset(tx, asset.id);
      if (asset.state !== "purged")
        await snapshotArchiveFile(tx, asset, {
          cleanups: closure.cleanups,
          cleanupIds: [cleanupId],
          epoch,
        });
    }
    return true;
  } catch (error) {
    if (error instanceof NativeArchiveScopeProtection) return false;
    if (
      error instanceof MediaError &&
      [
        "lineage_unresolved",
        "edition_not_available",
        "coverage_missing",
      ].includes(error.code)
    )
      return false;
    throw error;
  }
}
