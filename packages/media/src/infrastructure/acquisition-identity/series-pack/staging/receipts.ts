import { z } from "zod";
import { createHash } from "node:crypto";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  SeriesPackStagingPayloadV1Schema,
  SeriesPackStagingResultV1Schema,
  type SeriesPackStagingPreparedV1,
} from "#shared/acquisition/series-pack-staging-v1.ts";
import { assertSeriesPackStagingEntriesV1 } from "./scope.ts";

export function seriesPackStagingKeyV1(attemptId: string, batchIndex: number) {
  return `series-pack-staging-v1:${attemptId}:${String(batchIndex)}`;
}

/** Only the actual immutable prepared descriptors and its actual staged result are returned. */
export function readSeriesPackStagingReceiptV1(row: Operation) {
  const payload = SeriesPackStagingPayloadV1Schema.parse(row.payload);
  const { prepared } = payload;
  if (
    row.kind !== "stage_series_pack_members_v1" ||
    row.userId !== null ||
    row.targetId !== prepared.scope.attemptId ||
    row.idempotencyKey !==
      seriesPackStagingKeyV1(prepared.scope.attemptId, prepared.batchIndex) ||
    payload.raw !== canonicalJson(z.json().parse(prepared)) ||
    payload.preparedHash !== identityHash(prepared) ||
    payload.scopeRaw !== canonicalJson(z.json().parse(prepared.scope)) ||
    !["running", "completed"].includes(row.status)
  )
    throw new Error("Series pack staging original prepared parent changed");
  assertSeriesPackStagingEntriesV1(prepared);
  const result =
    row.result === null
      ? null
      : SeriesPackStagingResultV1Schema.parse(row.result);
  if (
    (row.status === "completed") !== (result !== null) ||
    (result !== null &&
      (result.raw !== canonicalJson(z.json().parse(result.completion)) ||
        result.completionHash !== identityHash(result.completion) ||
        result.completion.preparedHash !== payload.preparedHash ||
        result.completion.journals.length !== prepared.entries.length ||
        result.completion.journals.some((journal, index) => {
          const entry = prepared.entries[index];
          if (
            entry === undefined ||
            journal.path !== `journal/${entry.operationId}.json` ||
            createHash("sha256").update(journal.raw).digest("hex") !==
              journal.sha256 ||
            String(Buffer.byteLength(journal.raw, "utf8")) !== journal.sizeBytes
          )
            return true;
          const manifest = z
            .object({
              phase: z.literal("staged"),
              operationId: z.literal(entry.operationId),
              kind: z.literal("import"),
              sha256: z.literal(entry.checksum),
              previousSha256:
                entry.previousChecksum === null
                  ? z.null()
                  : z.literal(entry.previousChecksum),
            })
            .safeParse(JSON.parse(journal.raw));
          return !manifest.success;
        })))
  )
    throw new Error(
      "Series pack staging completion differs from its actual prepared parent",
    );
  return {
    operationId: row.id,
    prepared,
    preparedHash: payload.preparedHash,
    result,
  };
}
export type SeriesPackStagingReceiptV1 = ReturnType<
  typeof readSeriesPackStagingReceiptV1
>;

export async function loadSeriesPackStagingReceiptV1(
  tx: Prisma.TransactionClient,
  input: { attemptId: string; batchIndex: number },
  budget: PublicationAuthorityReadBudget,
) {
  const row = await tx.operation.findUnique({
    where: {
      idempotencyKey: seriesPackStagingKeyV1(input.attemptId, input.batchIndex),
    },
  });
  budget.consume(row === null ? 0 : 1);
  return row === null ? null : readSeriesPackStagingReceiptV1(row);
}

/** Born only after real member probing/hash/extraction and complete current authorization. */
export async function createSeriesPackStagingReceiptV1(
  tx: Prisma.TransactionClient,
  prepared: SeriesPackStagingPreparedV1,
  budget: PublicationAuthorityReadBudget,
) {
  assertSeriesPackStagingEntriesV1(prepared);
  const previous = await loadSeriesPackStagingReceiptV1(
    tx,
    {
      attemptId: prepared.scope.attemptId,
      batchIndex: prepared.batchIndex,
    },
    budget,
  );
  if (previous !== null) {
    if (previous.preparedHash !== identityHash(prepared))
      throw new Error(
        "Series pack prepared member descriptors cannot be replaced",
      );
    return previous;
  }
  const payload = SeriesPackStagingPayloadV1Schema.parse({
    schemaVersion: 1,
    kind: "stage_series_pack_members_v1",
    prepared,
    preparedHash: identityHash(prepared),
    scopeRaw: canonicalJson(z.json().parse(prepared.scope)),
    raw: canonicalJson(z.json().parse(prepared)),
  });
  // SQL birth independently queries this real immutable first parent again.
  if (prepared.batchIndex > 0) budget.consume(1);
  const row = await tx.operation.create({
    data: {
      idempotencyKey: seriesPackStagingKeyV1(
        prepared.scope.attemptId,
        prepared.batchIndex,
      ),
      userId: null,
      kind: "stage_series_pack_members_v1",
      targetId: prepared.scope.attemptId,
      payload: z.record(z.string(), z.json()).parse(payload),
      status: "running",
    },
  });
  budget.consume(1);
  return readSeriesPackStagingReceiptV1(row);
}

/** Called by the original staging effect transaction, after all actual staged journal ACKs. */
export async function completeSeriesPackStagingReceiptV1(
  tx: Prisma.TransactionClient,
  receipt: SeriesPackStagingReceiptV1,
  completion: z.infer<typeof SeriesPackStagingResultV1Schema>["completion"],
  budget: PublicationAuthorityReadBudget,
) {
  const result = SeriesPackStagingResultV1Schema.parse({
    schemaVersion: 1,
    completion,
    completionHash: identityHash(completion),
    raw: canonicalJson(z.json().parse(completion)),
  });
  if (completion.preparedHash !== receipt.preparedHash)
    throw new Error(
      "Series pack completion lost its exact prepared descriptor",
    );
  const updated = await tx.operation.update({
    where: { id: receipt.operationId },
    data: {
      status: "completed",
      result: z.record(z.string(), z.json()).parse(result),
    },
  });
  budget.consume(1);
  readSeriesPackStagingReceiptV1(updated);
}
