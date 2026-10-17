import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeCompensationInventorySchema,
  NativeCompensationContinuationViewSchema,
} from "#shared/native-recovery/compensation-runtime.ts";
import { loadPublicationIntent } from "#infrastructure/publication-proof/store.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { compensationRecord } from "./records.ts";
import { readVerifiedCompensationPublication } from "./publication-receipt.ts";

function inventoryProtection(input: {
  assetCount: number;
  current: number;
  released: boolean;
  committed: boolean;
  missingPredecessor: boolean;
}) {
  if (input.assetCount > 25) return "compensation_scope_exceeds_limit";
  if (input.current > 0) return "compensation_current_authority_already_exists";
  if (input.released)
    return "compensation_already_published_use_native_recovery";
  if (input.committed) return "compensation_transition_already_committed";
  return input.missingPredecessor ? "compensation_predecessor_missing" : null;
}

function publicationStateFor(input: {
  verified: boolean;
  incomplete: boolean;
  held: number;
  positiveCount: number;
  mediaCount: number;
  operation: { status: string } | null;
}) {
  if (input.verified) return "available";
  if (
    input.incomplete ||
    input.held > 0 ||
    input.positiveCount !== input.mediaCount
  )
    return "held";
  if (input.operation === null) return "ready";
  return ["failed", "reconciling", "cancelled"].includes(input.operation.status)
    ? "protected"
    : "publishing";
}

export async function compensationInventory(
  tx: Prisma.TransactionClient,
  cursor: string | null,
) {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const rows = await tx.mediaPublicationTransition.findMany({
    where: {
      birthEpoch: { lt: runtime.recoveryEpoch },
      ...(cursor === null ? {} : { id: { gt: cursor } }),
    },
    orderBy: { id: "asc" },
    take: 26,
  });
  const items = [];
  for (const row of rows.slice(0, 25)) {
    const reference = await loadPublicationIntent(tx, row.attemptId);
    if (reference?.transitionId !== row.id)
      throw new Error("Compensation inventory publication parent changed");
    const intent = reference.intent;
    const ids = [
      ...new Set(
        intent.entries.flatMap(({ entry }) => [
          entry.assetId,
          ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
        ]),
      ),
    ];
    const current = await tx.nativePublicationCompensationContinuation.count({
      where: { transitionId: row.id, recoveryEpoch: runtime.recoveryEpoch },
    });
    const previous =
      await tx.nativePublicationCompensationContinuation.findFirst({
        where: { transitionId: row.id },
        orderBy: { recoveryEpoch: "desc" },
      });
    if (
      previous?.fenceRelease != null &&
      (previous.publicationCoordinatorOperationId === null ||
        (await readVerifiedCompensationPublication(tx, {
          schemaVersion: 1,
          continuationId: previous.id,
          operationId: previous.publicationCoordinatorOperationId,
          recoveryEpoch: previous.recoveryEpoch,
        })) === null)
    )
      throw new Error(
        "Released latest compensation has no verified publication",
      );
    const successors = await tx.libraryAsset.count({
      where: { id: { in: intent.entries.map((item) => item.entry.assetId) } },
    });
    const protection = inventoryProtection({
      assetCount: ids.length,
      current,
      released: previous?.fenceRelease != null,
      committed: row.outcome !== null || successors > 0,
      missingPredecessor: intent.entries.some(
        (entry) => entry.predecessor === null,
      ),
    });
    const media = await tx.mediaItem.findMany({
      where: { id: { in: intent.mediaIds } },
      select: { id: true, title: true },
      orderBy: { id: "asc" },
    });
    items.push({
      transitionId: row.id,
      attemptId: row.attemptId,
      birthEpoch: row.birthEpoch,
      media,
      predecessors: intent.entries.flatMap((item) =>
        item.predecessor === null
          ? []
          : [{ assetId: item.predecessor.id, path: item.predecessor.path }],
      ),
      successorAssetIds: intent.entries.map((item) => item.entry.assetId),
      selectable: protection === null,
      protection,
    });
  }
  return NativeCompensationInventorySchema.parse({
    items,
    nextCursor: rows.length > 25 ? rows[24]?.id : null,
  });
}

export async function compensationContinuationViews(
  tx: Prisma.TransactionClient,
  planId: string,
) {
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: { receipt: { planId } },
    orderBy: { id: "asc" },
  });
  const views = [];
  for (const row of rows) {
    const record = await compensationRecord(tx, row.id);
    if (row.verifiedPublication !== null) {
      if (row.publicationCoordinatorOperationId === null)
        throw new Error("Verified compensation coordinator missing");
      await readVerifiedCompensationPublication(tx, {
        schemaVersion: 1,
        continuationId: row.id,
        operationId: row.publicationCoordinatorOperationId,
        recoveryEpoch: row.recoveryEpoch,
      });
    }
    const media = await tx.mediaItem.findMany({
      where: { id: { in: row.mediaIds } },
      select: { id: true, title: true, availability: true },
      orderBy: { id: "asc" },
    });
    const intents = await tx.mediaIntent.findMany({
      where: {
        edition: "default",
        mediaId: { in: row.mediaIds },
        automationEpoch: row.recoveryEpoch,
        desiredPresence: true,
        monitoring: true,
        intentionallyRemovedAt: null,
      },
    });
    const claims = await tx.mediaRequest.findMany({
      where: { ...effectiveRequestWhere, mediaId: { in: row.mediaIds } },
      select: { mediaId: true },
    });
    const currentPositiveMediaIds = intents
      .filter((intent) =>
        claims.some((claim) => claim.mediaId === intent.mediaId),
      )
      .map((intent) => intent.mediaId);
    const held = await tx.recoveryHold.count({
      where: {
        edition: "default",
        mediaId: { in: row.mediaIds },
        releasedAt: null,
      },
    });
    const operation =
      row.publicationCoordinatorOperationId === null
        ? null
        : await tx.operation.findUniqueOrThrow({
            where: { id: row.publicationCoordinatorOperationId },
          });
    const publicationState = publicationStateFor({
      verified: row.verifiedPublication !== null,
      incomplete: record.completion === null,
      held,
      positiveCount: currentPositiveMediaIds.length,
      mediaCount: row.mediaIds.length,
      operation,
    });
    views.push(
      NativeCompensationContinuationViewSchema.parse({
        id: row.id,
        transitionId: row.transitionId,
        version: row.version,
        state: row.state,
        publicationState,
        fenceActive: row.fenceRelease === null,
        protectedReason:
          row.state === "protected"
            ? "compensation_requires_review"
            : publicationState === "held"
              ? "compensation_household_reconciliation_required"
              : null,
        currentPositiveMediaIds,
        media,
      }),
    );
  }
  return views;
}
