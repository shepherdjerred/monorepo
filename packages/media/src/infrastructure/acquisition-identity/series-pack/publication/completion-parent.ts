import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  SeriesPackPublicationOutcomeV3Schema,
  type SeriesPackPublicationIntentV3,
  type SeriesPackPublicationOutcomeV3,
} from "#shared/acquisition/series-pack-publication-v1.ts";

export async function assertSeriesPackCompletionParentV1(
  tx: Prisma.TransactionClient,
  input: {
    row: Prisma.MediaPublicationTransitionGetPayload<Record<string, never>>;
    intent: SeriesPackPublicationIntentV3;
    outcome: SeriesPackPublicationOutcomeV3;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { row, intent, outcome } = input;
  const seal = await tx.operation.findUniqueOrThrow({
    where: { id: outcome.seriesPackPublication.sealOperationId },
  });
  budget.consume(1);
  const payload = z
    .strictObject({
      schemaVersion: z.literal(1),
      kind: z.literal("seal_series_pack_publication_v1"),
      attemptId: z.uuid(),
      operationId: z.uuid(),
      intentHash: z.string(),
      outcome: SeriesPackPublicationOutcomeV3Schema,
      outcomeHash: z.string(),
      raw: z.string().min(1).max(16_777_216),
    })
    .parse(seal.payload);
  if (
    seal.kind !== payload.kind ||
    seal.userId !== null ||
    seal.status !== "completed" ||
    seal.result !== null ||
    seal.targetId !== row.attemptId ||
    seal.idempotencyKey !==
      `series-pack-publication-seal-v1:${row.attemptId}` ||
    payload.attemptId !== row.attemptId ||
    payload.operationId !==
      intent.seriesPackPublication.coordinatorOperationId ||
    payload.intentHash !== row.intentHash ||
    payload.outcomeHash !== row.outcomeHash ||
    payload.raw !== canonicalJson(z.json().parse(payload.outcome)) ||
    identityHash(payload.outcome) !== row.outcomeHash ||
    identityHash(payload.outcome) !== identityHash(outcome)
  )
    throw new Error(
      "Series pack publication completion lost its actual immutable seal parent",
    );
}
