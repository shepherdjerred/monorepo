import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import { SeriesPackNativeFinishedV4Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import { SeriesPackNativeDetailV1Schema } from "#shared/native-recovery/series-pack/detail.ts";
import { NativeCompensationContinuationViewSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { loadSeriesPackNativeParentsV1 } from "./parents.ts";
import { readSeriesPackNativeCoreRecordV1 } from "./records.ts";
import { readSeriesPackNativePublicationV1 } from "./publication/record.ts";

type DetailRow = Prisma.NativeRecoveryPlanGetPayload<{
  include: { receipt: true };
}>;

function publicationState(input: {
  verified: boolean;
  completed: boolean;
  held: number;
  positive: number;
  expected: number;
  operation: { status: string } | null;
}) {
  if (input.verified) return "available";
  if (!input.completed || input.held > 0 || input.positive !== input.expected)
    return "held";
  if (input.operation === null) return "ready";
  return ["failed", "reconciling", "cancelled"].includes(input.operation.status)
    ? "protected"
    : "publishing";
}

async function continuationView(
  tx: Prisma.TransactionClient,
  row: Prisma.NativePublicationCompensationContinuationGetPayload<
    Record<string, never>
  >,
  budget: PublicationAuthorityReadBudget,
) {
  const verified =
    row.verifiedPublication === null
      ? null
      : await readSeriesPackNativePublicationV1(
          tx,
          {
            schemaVersion: 1,
            continuationId: row.id,
            operationId: requiredPublicationCoordinator(row),
            recoveryEpoch: row.recoveryEpoch,
          },
          budget,
        );
  const record =
    verified?.record ??
    (await readSeriesPackNativeCoreRecordV1(tx, row.id, budget));
  if (verified === null && row.verifiedPublication !== null)
    throw new Error("Native pack serving receipt changed during detail read");
  const media = await tx.mediaItem.findMany({
    where: { id: { in: record.row.mediaIds } },
    select: { id: true, title: true, availability: true },
    orderBy: { id: "asc" },
  });
  const positive = await tx.mediaIntent.findMany({
    where: {
      edition: "default",
      mediaId: { in: record.row.mediaIds },
      automationEpoch: record.row.recoveryEpoch,
      desiredPresence: true,
      monitoring: true,
      intentionallyRemovedAt: null,
    },
    select: { mediaId: true },
  });
  const claims = await tx.mediaRequest.groupBy({
    by: ["mediaId"],
    where: {
      ...effectiveRequestWhere,
      mediaId: { in: record.row.mediaIds },
    },
  });
  const currentPositiveMediaIds = positive
    .filter((intent) =>
      claims.some((claim) => claim.mediaId === intent.mediaId),
    )
    .map((intent) => intent.mediaId);
  const held = await tx.recoveryHold.count({
    where: {
      edition: "default",
      mediaId: { in: record.row.mediaIds },
      releasedAt: null,
    },
  });
  const operation =
    record.row.publicationCoordinatorOperationId === null
      ? null
      : await tx.operation.findUniqueOrThrow({
          where: { id: record.row.publicationCoordinatorOperationId },
        });
  if (operation !== null) budget.consume(1);
  const state = publicationState({
    verified: verified !== null,
    completed: record.completion !== null,
    held,
    positive: currentPositiveMediaIds.length,
    expected: record.row.mediaIds.length,
    operation,
  });
  return NativeCompensationContinuationViewSchema.parse({
    id: record.row.id,
    transitionId: record.row.transitionId,
    version: record.row.version,
    state: record.row.state,
    publicationState: state,
    fenceActive: record.row.fenceRelease === null,
    protectedReason:
      record.row.state === "protected"
        ? "compensation_requires_review"
        : state === "held"
          ? "compensation_household_reconciliation_required"
          : null,
    currentPositiveMediaIds,
    media,
  });
}

function requiredPublicationCoordinator(row: {
  publicationCoordinatorOperationId: string | null;
}) {
  if (row.publicationCoordinatorOperationId === null)
    throw new Error("Verified native pack publication coordinator missing");
  return row.publicationCoordinatorOperationId;
}

/** Display is never an effect grant. Resolve the actual literal parents using
 * the API caller's original allowance; no stored v3 body enters a v1 decoder. */
export async function seriesPackNativeDetailV1(
  tx: Prisma.TransactionClient,
  row: DetailRow,
  budget: PublicationAuthorityReadBudget,
) {
  const scope = SeriesPackNativeCompensationScopeV3Schema.parse(row.scope);
  const plan =
    row.plan === null ? null : SeriesPackNativeFinishedV4Schema.parse(row.plan);
  if (
    (plan === null) !== (row.planHash === null) ||
    (plan !== null &&
      (identityHash(plan) !== row.planHash ||
        plan.scopeHash !== identityHash(scope)))
  )
    throw new Error("Native pack detail lost its literal reviewed plan");
  const continuations =
    await tx.nativePublicationCompensationContinuation.findMany({
      where: { receipt: { planId: row.id } },
      orderBy: { id: "asc" },
      take: 2,
    });
  budget.consume(continuations.length);
  if (continuations.length > 1)
    throw new Error("Native pack plan has multiple admitted continuations");
  const views = [];
  for (const continuation of continuations)
    views.push(await continuationView(tx, continuation, budget));
  if (continuations.length === 0) {
    const parents = await loadSeriesPackNativeParentsV1(
      tx,
      scope.publication.intent.attemptId,
      budget,
    );
    if (
      identityHash(parents.publication.reference) !==
      identityHash(scope.publication)
    )
      throw new Error("Native pack detail changed its original publication");
  }
  return SeriesPackNativeDetailV1Schema.parse({
    schemaVersion: 1,
    protocol: "series_pack_native_compensation_v1",
    id: row.id,
    state: row.state,
    version: row.version,
    scope,
    plan,
    planHash: row.planHash,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    receiptId: row.receipt?.id ?? null,
    continuations: [],
    compensationContinuations: views,
  });
}
