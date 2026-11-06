import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  InterruptedPublicationWorkSchema,
  RevokedReservationSchema,
  CompensationSettlementSchema,
  type InterruptedPublicationWork,
} from "#shared/native-recovery/compensation.ts";
import {
  NativeLifecycleSchema,
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { historicalDefaultRow } from "#infrastructure/native-recovery/legacy-snapshot.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { SeriesPackNativeParentsV1 } from "./parents.ts";

/** The attempt was actually queried and charged by the same held transaction. */
export async function captureSeriesPackInterruptedV1(
  tx: Prisma.TransactionClient,
  graph: SeriesPackNativeParentsV1,
) {
  if (graph.transaction !== tx)
    throw new Error("Interrupted pack snapshot belongs to another transaction");
  const { reference, attempt } = graph.publication;
  const rows = await tx.acquisitionReservation.findMany({
    where: { attemptId: attempt.id },
    orderBy: { mediaId: "asc" },
    take: 101,
  });
  const reservations = z
    .array(RevokedReservationSchema)
    .max(100)
    .parse(nativeJson(rows));
  if (
    reservations.some((row) => !reference.intent.mediaIds.includes(row.mediaId))
  )
    throw new Error(
      "Interrupted pack reservation exceeds original whole scope",
    );
  return InterruptedPublicationWorkSchema.parse({
    transitionId: reference.transitionId,
    intentHash: reference.intentHash,
    attemptId: attempt.id,
    birthEpoch: reference.intent.birthEpoch,
    filePlanHash: reference.intent.filePlanHash,
    attemptSnapshotHash: identityHash(nativeAttempt(attempt)),
    reservations,
    reservationSetHash: identityHash(reservations),
  });
}

export async function seriesPackInterruptedLifecycleV1(
  tx: Prisma.TransactionClient,
  graph: SeriesPackNativeParentsV1,
  interrupted: InterruptedPublicationWork,
) {
  const intent = graph.publication.reference.intent;
  const assetIds = intent.entries.flatMap((item) => [
    item.entry.assetId,
    ...(item.predecessor === null ? [] : [item.predecessor.id]),
  ]);
  const attempts = await tx.acquisitionAttempt.findMany({
    where: { edition: "default", mediaIds: { hasSome: intent.mediaIds } },
    orderBy: { id: "asc" },
    take: 101,
  });
  const reservations = await tx.acquisitionReservation.findMany({
    where: { edition: "default", mediaId: { in: intent.mediaIds } },
    orderBy: { mediaId: "asc" },
    take: 101,
  });
  const retention = await tx.retentionDecision.findMany({
    where: { edition: "default", mediaId: { in: intent.mediaIds } },
    orderBy: { id: "asc" },
    take: 101,
  });
  const cleanup = await tx.upgradeCleanup.findMany({
    where: {
      OR: [
        { assetId: { in: assetIds } },
        { successorAssetId: { in: assetIds } },
      ],
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (
    attempts.length > 100 ||
    reservations.length > 100 ||
    retention.length > 100 ||
    cleanup.length > 100 ||
    attempts.some(
      (row) =>
        row.id !== intent.attemptId &&
        !["completed", "cancelled", "obsolete", "rolled_back"].includes(
          row.state,
        ),
    ) ||
    reservations.some((row) => row.attemptId !== intent.attemptId) ||
    identityHash(nativeJson(reservations)) !== interrupted.reservationSetHash ||
    retention.some(
      (row) =>
        row.manifest !== null &&
        !["cancelled", "restored", "purged"].includes(row.state),
    ) ||
    cleanup.some(
      (row) => !["completed", "cancelled", "protected"].includes(row.state),
    )
  )
    throw new Error(
      "Unrelated current lifecycle work prevents whole native pack compensation",
    );
  return NativeLifecycleSchema.parse(
    nativeJson({
      attempts: attempts.map((row) => nativeAttempt(row)),
      reservations: reservations.map((row) => historicalDefaultRow(row)),
      retention: retention.map((row) => historicalDefaultRow(row)),
      cleanup,
    }),
  );
}

export async function settleSeriesPackInterruptedV1(
  tx: Prisma.TransactionClient,
  graph: SeriesPackNativeParentsV1,
  reviewed: InterruptedPublicationWork,
) {
  const actual = await captureSeriesPackInterruptedV1(tx, graph);
  if (identityHash(actual) !== identityHash(reviewed))
    throw new Error(
      "Exact revoked pack reservations or interrupted attempt changed",
    );
  for (const row of reviewed.reservations) {
    const deleted = await tx.acquisitionReservation.deleteMany({
      where: { ...row, createdAt: new Date(row.createdAt) },
    });
    if (deleted.count !== 1)
      throw new Error("Reviewed pack reservation CAS failed");
  }
  const { reservations: releasedReservations, ...fixed } = reviewed;
  return CompensationSettlementSchema.parse({ ...fixed, releasedReservations });
}
