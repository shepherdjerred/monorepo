import { z } from "zod";
import { Prisma, type Operation } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MovieSubtitleReceiptV4Schema } from "#shared/movie-editions/subtitle-receipt-v4.ts";
import { assertMovieSubtitleReceiptV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Exact pending participant discovery only. Completed rollback is settled;
 * unrelated cuts and their immutable parents are never materialized. */
export async function hasPendingMovieRollbackCaptionParticipantV1(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    assetId: string;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const records = z.array(z.strictObject({ id: z.uuid() })).parse(
    await tx.$queryRaw(Prisma.sql`
    SELECT o.id FROM "Operation" o WHERE o.result#>'{movieRollbackIntentV1,intent,scope}'=${JSON.stringify(input.scope)}::jsonb
      AND NOT(COALESCE(o.result,'{}'::jsonb)?'movieRollbackPlexV1')
      AND (o.result#>>'{movieRollbackIntentV1,intent,predecessor,id}'=${input.assetId} OR o.result#>>'{movieRollbackIntentV1,intent,successor,id}'=${input.assetId})
    ORDER BY o.id LIMIT ${budget.take}`),
  );
  budget.consume(records.length);
  return records.length > 0;
}

/** A queued orchestration row can already have its immutable Files completion.
 * Only the actual validated ACK is independent of rollback's physical paths. */
export async function assertMovieRollbackPendingWorkV1(
  tx: Prisma.TransactionClient,
  input: {
    assetIds: readonly string[];
    scope: MovieEditionScope;
    epoch: number;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const pending = await tx.operation.findMany({
    where: {
      targetId: { in: [...input.assetIds] },
      status: { in: ["queued", "running"] },
    },
    take: budget.take,
  });
  budget.consume(pending.length);
  for (const operation of pending) {
    const marker = z
      .object({ movieSubtitleReceiptV4: z.unknown().optional() })
      .nullable()
      .parse(operation.result)?.movieSubtitleReceiptV4;
    if (marker === undefined || operation.kind !== "acquire_movie_subtitles_v4")
      throw new FileGuardError("movie_rollback_dependencies_active");
    assertCompletedWrapper(operation, marker, input);
  }
}

/** SQL046 closed this immutable receipt's installation ancestry at birth.
 * This purpose only proves the queued wrapper has no remaining physical work;
 * it grants no installation authority. Current full A/B inventory and caption
 * provenance remain independently required by Files admission. */
function assertCompletedWrapper(
  operation: Operation,
  marker: unknown,
  input: {
    assetIds: readonly string[];
    scope: MovieEditionScope;
    epoch: number;
  },
) {
  const completed = z
    .strictObject({
      receipt: z.json(),
      receiptHash: z.string(),
    })
    .parse(marker);
  const receipt = parsePlexRecord(
    MovieSubtitleReceiptV4Schema,
    completed.receipt,
    completed.receiptHash,
  );
  const { kind: _kind, ...target } = MovieSubtitleOperationV4Schema.extend({
    kind: z.literal("acquire_movie_subtitles_v4"),
  }).parse(operation.payload);
  assertMovieSubtitleReceiptV4(receipt);
  if (
    receipt.input.operationId !== operation.id ||
    target.operationId !== operation.id ||
    receipt.command.kind !== operation.kind ||
    receipt.command.targetId !== operation.targetId ||
    receipt.command.payloadHash !== identityHash(operation.payload) ||
    identityHash(target) !== identityHash(receipt.target) ||
    identityHash(receipt.input.scope) !== identityHash(input.scope) ||
    !input.assetIds.includes(receipt.input.assetId) ||
    target.recoveryEpoch !== input.epoch ||
    receipt.publication.assetVersion !== receipt.after.videoVersion
  )
    throw new FileGuardError("movie_rollback_dependencies_active");
}
