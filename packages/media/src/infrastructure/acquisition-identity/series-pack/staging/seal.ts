import { z } from "zod";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  SERIES_PACK_STAGING_BATCH_SIZE_V1,
  SeriesPackStagingSealPayloadV1Schema,
  type SeriesPackStagingScopeV1,
  type SeriesPackStagingSealV1,
} from "#shared/acquisition/series-pack-staging-v1.ts";
import {
  readSeriesPackStagingReceiptV1,
  type SeriesPackStagingReceiptV1,
} from "./receipts.ts";

export function seriesPackStagingSealKeyV1(attemptId: string) {
  return `series-pack-staging-seal-v1:${attemptId}`;
}

export function readSeriesPackStagingSealV1(row: Operation) {
  const payload = SeriesPackStagingSealPayloadV1Schema.parse(row.payload);
  const { seal } = payload;
  if (
    row.kind !== "seal_series_pack_staging_v1" ||
    row.status !== "completed" ||
    row.userId !== null ||
    row.result !== null ||
    row.targetId !== seal.attemptId ||
    row.idempotencyKey !== seriesPackStagingSealKeyV1(seal.attemptId) ||
    payload.raw !== canonicalJson(z.json().parse(seal)) ||
    payload.sealHash !== identityHash(seal) ||
    payload.scopeRaw !== canonicalJson(z.json().parse(seal.scope)) ||
    identityHash(JSON.parse(payload.filePlanRaw)) !== seal.filePlanHash ||
    seal.scopeHash !== identityHash(seal.scope) ||
    seal.scope.attemptId !== seal.attemptId ||
    seal.scope.operationId !== seal.operationId
  )
    throw new Error("Series pack staging seal lost its actual complete parent");
  return { operationId: row.id, sealHash: payload.sealHash, seal };
}

/** This real completed collection is a protocol selector, never a publication grant. */
export async function loadSeriesPackStagingSealV1(
  tx: Prisma.TransactionClient,
  attemptId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const row = await tx.operation.findUnique({
    where: { idempotencyKey: seriesPackStagingSealKeyV1(attemptId) },
  });
  budget.consume(row === null ? 0 : 1);
  return row === null ? null : readSeriesPackStagingSealV1(row);
}

export async function loadSeriesPackStagingBatchesV1(
  tx: Prisma.TransactionClient,
  scope: SeriesPackStagingScopeV1,
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.operation.findMany({
    where: { kind: "stage_series_pack_members_v1", targetId: scope.attemptId },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  const receipts = rows.map((row) => readSeriesPackStagingReceiptV1(row));
  return completeSeriesPackStagingPartitionV1(scope, receipts);
}

/** No sorting/filtering may hide an extra, missing, foreign or overlapping actual parent. */
export function completeSeriesPackStagingPartitionV1(
  scope: SeriesPackStagingScopeV1,
  receipts: readonly SeriesPackStagingReceiptV1[],
) {
  const ordered = [...receipts].sort(
    (a, b) => a.prepared.batchIndex - b.prepared.batchIndex,
  );
  if (
    ordered.length !==
      Math.ceil(scope.members.length / SERIES_PACK_STAGING_BATCH_SIZE_V1) ||
    new Set(ordered.map((receipt) => receipt.operationId)).size !==
      ordered.length ||
    ordered.some(
      (receipt, index) =>
        receipt.result === null ||
        receipt.prepared.batchIndex !== index ||
        receipt.prepared.scopeHash !== identityHash(scope) ||
        identityHash(receipt.prepared.scope) !== identityHash(scope),
    )
  )
    throw new Error(
      "Series pack staging needs every exact completed member batch",
    );
  const plan = ordered.flatMap((receipt) => receipt.prepared.entries);
  const covered = plan.flatMap((entry) => entry.mediaIds);
  if (
    plan.length !== scope.members.length ||
    new Set(plan.map((entry) => entry.assetId)).size !== plan.length ||
    new Set(plan.map((entry) => entry.operationId)).size !== plan.length ||
    new Set(covered).size !== covered.length ||
    identityHash([...covered].sort()) !== identityHash(scope.coverage)
  )
    throw new Error(
      "Series pack staging complete plan changed its exact coverage",
    );
  return { receipts: ordered, plan };
}

export async function createSeriesPackStagingSealV1(
  tx: Prisma.TransactionClient,
  seal: SeriesPackStagingSealV1,
  filePlan: unknown,
  budget: PublicationAuthorityReadBudget,
) {
  const payload = SeriesPackStagingSealPayloadV1Schema.parse({
    schemaVersion: 1,
    kind: "seal_series_pack_staging_v1",
    seal,
    sealHash: identityHash(seal),
    raw: canonicalJson(z.json().parse(seal)),
    scopeRaw: canonicalJson(z.json().parse(seal.scope)),
    filePlanRaw: canonicalJson(z.json().parse(filePlan)),
  });
  // The final SQL seal independently queries every actual immutable batch parent.
  budget.consume(seal.receipts.length);
  const row = await tx.operation.create({
    data: {
      idempotencyKey: seriesPackStagingSealKeyV1(seal.attemptId),
      userId: null,
      targetId: seal.attemptId,
      kind: "seal_series_pack_staging_v1",
      status: "completed",
      payload: z.record(z.string(), z.json()).parse(payload),
    },
  });
  budget.consume(1);
  return readSeriesPackStagingSealV1(row);
}
