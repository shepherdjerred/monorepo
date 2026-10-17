import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  InterruptedPublicationWorkSchema,
  CompensationSettlementSchema,
  RevokedReservationSchema,
  type InterruptedPublicationWork,
  type CompensationSettlement,
} from "#shared/native-recovery/compensation.ts";
import { NativeCompensationCompletionSchema } from "#shared/native-recovery/compensation-runtime.ts";
import {
  NativeLifecycleSchema,
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { historicalDefaultRow } from "#infrastructure/native-recovery/legacy-snapshot.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { loadPublicationIntent } from "./store.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import { PublicationAuthorityReadBudget } from "./read-budget.ts";

export type NativeLifecycleSnapshot = z.infer<typeof NativeLifecycleSchema>;
async function reservations(tx: Prisma.TransactionClient, attemptId: string) {
  const rows = await tx.acquisitionReservation.findMany({
    where: { attemptId },
    orderBy: { mediaId: "asc" },
  });
  return z.array(RevokedReservationSchema).max(100).parse(nativeJson(rows));
}

export async function captureInterruptedPublicationWork(
  tx: Prisma.TransactionClient,
  transitionId: string,
): Promise<InterruptedPublicationWork> {
  const row = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: transitionId },
  });
  const reference = await loadPublicationIntent(tx, row.attemptId);
  if (reference?.transitionId !== transitionId)
    throw new Error("Publication transition missing");
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: row.attemptId },
  });
  if (
    attempt.edition !== "default" ||
    attempt.recoveryEpoch !== reference.intent.birthEpoch ||
    snapshotHash(nativeJson(attempt.filePlan)) !==
      reference.intent.filePlanHash ||
    snapshotHash([...attempt.mediaIds].sort()) !==
      snapshotHash([...reference.intent.mediaIds].sort())
  )
    throw new Error("Interrupted publication attempt authority changed");
  const selected = await reservations(tx, attempt.id);
  if (selected.some((item) => !attempt.mediaIds.includes(item.mediaId)))
    throw new Error("Interrupted reservation exceeds the complete attempt");
  return InterruptedPublicationWorkSchema.parse({
    transitionId,
    intentHash: reference.intentHash,
    attemptId: attempt.id,
    birthEpoch: reference.intent.birthEpoch,
    filePlanHash: reference.intent.filePlanHash,
    attemptSnapshotHash: snapshotHash(nativeAttempt(attempt)),
    reservations: selected,
    reservationSetHash: snapshotHash(nativeJson(selected)),
  });
}

export async function nativeCompensationLifecycle(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: readonly string[];
    assetIds: readonly string[];
    interrupted: InterruptedPublicationWork;
  },
): Promise<NativeLifecycleSnapshot> {
  const { mediaIds, assetIds, interrupted } = input;
  if (
    snapshotHash(
      nativeJson(
        await captureInterruptedPublicationWork(tx, interrupted.transitionId),
      ),
    ) !== snapshotHash(nativeJson(interrupted))
  )
    throw new Error("Interrupted publication snapshot changed");
  const attempts = await tx.acquisitionAttempt.findMany({
    where: { edition: "default", mediaIds: { hasSome: [...mediaIds] } },
    orderBy: { id: "asc" },
    take: 101,
  });
  const active = await tx.acquisitionReservation.findMany({
    where: { edition: "default", mediaId: { in: [...mediaIds] } },
    orderBy: { mediaId: "asc" },
  });
  const retention = await tx.retentionDecision.findMany({
    where: { edition: "default", mediaId: { in: [...mediaIds] } },
    orderBy: { id: "asc" },
    take: 101,
  });
  const cleanup = await tx.upgradeCleanup.findMany({
    where: {
      OR: [
        { assetId: { in: [...assetIds] } },
        { successorAssetId: { in: [...assetIds] } },
      ],
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  const unsettled = [];
  const budget = new PublicationAuthorityReadBudget();
  for (const row of attempts) {
    if (
      row.id === interrupted.attemptId ||
      ["completed", "cancelled", "obsolete", "rolled_back"].includes(row.state)
    )
      continue;
    if (
      (await resolveCompletedCompensationSettlement(tx, row.id, budget)) ===
      null
    )
      unsettled.push(row.id);
  }
  if (
    unsettled.length > 0 ||
    active.some((row) => row.attemptId !== interrupted.attemptId) ||
    snapshotHash(nativeJson(active)) !== interrupted.reservationSetHash ||
    retention.some(
      (row) =>
        row.manifest !== null &&
        !["cancelled", "restored", "purged"].includes(row.state),
    )
  )
    throw new Error(
      "Unrelated lifecycle work requires separate reconciliation",
    );
  return NativeLifecycleSchema.parse(
    nativeJson({
      attempts: attempts.map((row) => nativeAttempt(row)),
      reservations: active.map((row) => historicalDefaultRow(row)),
      retention: retention.map((row) => historicalDefaultRow(row)),
      cleanup,
    }),
  );
}

export async function settleReviewedReservations(
  tx: Prisma.TransactionClient,
  reviewed: InterruptedPublicationWork,
): Promise<CompensationSettlement> {
  const current = await captureInterruptedPublicationWork(
    tx,
    reviewed.transitionId,
  );
  if (snapshotHash(nativeJson(current)) !== snapshotHash(nativeJson(reviewed)))
    throw new Error("Reviewed revoked reservations or attempt changed");
  for (const row of reviewed.reservations) {
    const deleted = await tx.acquisitionReservation.deleteMany({
      where: {
        mediaId: row.mediaId,
        edition: row.edition,
        attemptId: row.attemptId,
        generation: row.generation,
        createdAt: new Date(row.createdAt),
      },
    });
    if (deleted.count !== 1)
      throw new Error("Exact revoked reservation settlement failed");
  }
  const { reservations: releasedReservations, ...authority } = reviewed;
  return CompensationSettlementSchema.parse({
    ...authority,
    releasedReservations,
  });
}

export async function resolveCompletedCompensationSettlement(
  tx: Prisma.TransactionClient,
  attemptId: string,
  budget?: PublicationAuthorityReadBudget,
): Promise<CompensationSettlement | null> {
  const rows = await tx.nativePublicationCompensationContinuation.findMany({
    where: { state: "compensated", transition: { attemptId } },
    orderBy: { recoveryEpoch: "desc" },
    take: budget?.take ?? 101,
  });
  budget?.consume(rows.length);
  if (rows.length > 100)
    throw new Error("Compensation settlement lookup exceeds bound");
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  for (const row of rows) {
    const validated = await compensationRecord(tx, row.id, budget);
    const completion = NativeCompensationCompletionSchema.parse(
      validated.completion,
    );
    const settlement = completion.settlement;
    if (
      completion.continuationId !== row.id ||
      completion.descriptorHash !== row.descriptorHash ||
      completion.recoveryEpoch !== row.recoveryEpoch ||
      completion.receiptId !== row.receiptId ||
      settlement.transitionId !== row.transitionId ||
      settlement.attemptId !== attemptId
    )
      throw new Error("Compensation settlement parent changed");
    if (
      snapshotHash(nativeAttempt(attempt)) === settlement.attemptSnapshotHash &&
      snapshotHash(nativeJson(settlement.releasedReservations)) ===
        settlement.reservationSetHash
    ) {
      const remaining = await reservations(tx, attemptId);
      if (remaining.length === 0) return settlement;
    }
  }
  return null;
}
