import { z } from "zod";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
  SeriesPackPublicationPreparationPayloadV1Schema,
  SeriesPackPublicationPhysicalPayloadV1Schema,
  SeriesPackPublicationPhysicalResultV1Schema,
  type SeriesPackPublicationPreparedV1,
  type SeriesPackPublicationScopeV1,
} from "#shared/acquisition/series-pack-publication-v1.ts";

export function seriesPackPreparationKeyV1(attemptId: string, index: number) {
  return `series-pack-publication-prepare-v1:${attemptId}:${String(index)}`;
}
export function seriesPackPhysicalKeyV1(attemptId: string, index: number) {
  return `series-pack-publication-physical-v1:${attemptId}:${String(index)}`;
}
export function readSeriesPackPreparationV1(row: Operation) {
  const payload = SeriesPackPublicationPreparationPayloadV1Schema.parse(
    row.payload,
  );
  const { prepared } = payload;
  if (
    row.kind !== payload.kind ||
    row.status !== "completed" ||
    row.userId !== null ||
    row.result !== null ||
    row.targetId !== prepared.scope.attemptId ||
    row.idempotencyKey !==
      seriesPackPreparationKeyV1(
        prepared.scope.attemptId,
        prepared.batchIndex,
      ) ||
    payload.raw !== canonicalJson(z.json().parse(prepared)) ||
    payload.preparedHash !== identityHash(prepared) ||
    payload.scopeRaw !== canonicalJson(z.json().parse(prepared.scope)) ||
    prepared.scopeHash !== identityHash(prepared.scope) ||
    identityHash(JSON.parse(payload.filePlanRaw)) !==
      prepared.scope.filePlanHash
  )
    throw new Error("Series pack publication preparation parent changed");
  const start = prepared.batchIndex * SERIES_PACK_PUBLICATION_BATCH_SIZE_V1;
  if (
    identityHash(prepared.entries.map(({ entry }) => entry.operationId)) !==
    identityHash(
      prepared.scope.entryOperationIds.slice(
        start,
        start + SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
      ),
    )
  )
    throw new Error(
      "Series pack publication preparation changed its exact partition",
    );
  if (
    prepared.entries.some((item) => identityHash(item.entry) !== item.entryHash)
  )
    throw new Error("Series pack publication entry raw hash changed");
  return { operationId: row.id, preparedHash: payload.preparedHash, prepared };
}
export function readSeriesPackPhysicalV1(row: Operation) {
  const payload = SeriesPackPublicationPhysicalPayloadV1Schema.parse(
    row.payload,
  );
  const result = SeriesPackPublicationPhysicalResultV1Schema.parse(row.result);
  const { command } = payload;
  if (
    row.kind !== command.kind ||
    row.status !== "completed" ||
    row.userId !== null ||
    row.targetId !== command.attemptId ||
    row.idempotencyKey !==
      seriesPackPhysicalKeyV1(command.attemptId, command.batchIndex) ||
    payload.raw !== canonicalJson(z.json().parse(command)) ||
    payload.commandHash !== identityHash(command) ||
    result.raw !== canonicalJson(z.json().parse(result.completion)) ||
    result.completionHash !== identityHash(result.completion) ||
    result.completion.commandHash !== payload.commandHash ||
    identityHash(command.entryOperationIds) !==
      identityHash(
        result.completion.entries.map((entry) => entry.entryOperationId),
      )
  )
    throw new Error("Series pack physical publication receipt changed");
  return {
    operationId: row.id,
    command,
    commandHash: payload.commandHash,
    completionHash: result.completionHash,
    completion: result.completion,
  };
}
export async function loadSeriesPackPreparationsV1(
  tx: Prisma.TransactionClient,
  scope: SeriesPackPublicationScopeV1,
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.operation.findMany({
    where: {
      kind: "prepare_series_pack_publication_v1",
      targetId: scope.attemptId,
    },
    take: budget.take,
  });
  budget.consume(rows.length);
  const receipts = rows
    .map((row) => readSeriesPackPreparationV1(row))
    .sort((a, b) => a.prepared.batchIndex - b.prepared.batchIndex);
  if (
    receipts.length !==
      Math.ceil(
        scope.entryOperationIds.length / SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
      ) ||
    receipts.some(
      (receipt, index) =>
        receipt.prepared.batchIndex !== index ||
        identityHash(receipt.prepared.scope) !== identityHash(scope),
    )
  )
    throw new Error(
      "Series pack publication preparation is incomplete or foreign",
    );
  return receipts;
}
export async function createSeriesPackPreparationV1(
  tx: Prisma.TransactionClient,
  prepared: SeriesPackPublicationPreparedV1,
  filePlan: unknown,
) {
  const payload = SeriesPackPublicationPreparationPayloadV1Schema.parse({
    schemaVersion: 1,
    kind: "prepare_series_pack_publication_v1",
    prepared,
    preparedHash: identityHash(prepared),
    raw: canonicalJson(z.json().parse(prepared)),
    scopeRaw: canonicalJson(z.json().parse(prepared.scope)),
    filePlanRaw: canonicalJson(z.json().parse(filePlan)),
  });
  return readSeriesPackPreparationV1(
    await tx.operation.create({
      data: {
        kind: payload.kind,
        targetId: prepared.scope.attemptId,
        userId: null,
        status: "completed",
        idempotencyKey: seriesPackPreparationKeyV1(
          prepared.scope.attemptId,
          prepared.batchIndex,
        ),
        payload: z.record(z.string(), z.json()).parse(payload),
      },
    }),
  );
}
export type SeriesPackPreparationReceiptV1 = ReturnType<
  typeof readSeriesPackPreparationV1
>;
export type SeriesPackPhysicalReceiptV1 = ReturnType<
  typeof readSeriesPackPhysicalV1
>;
