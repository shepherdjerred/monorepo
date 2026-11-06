import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import { MovieRollbackInvocationV1Schema } from "#shared/movie-editions/rollback/operation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertPublicationSnapshotSuccessor } from "#infrastructure/publication-proof/authority.ts";
import { compensationSubtitleLineage } from "#infrastructure/native-compensation/subtitle-lineage.ts";
import { readMovieRollbackPhysicalV1 } from "./records.ts";

/** Match one exact scoped version; unrelated editions are never materialized. */
export async function findMovieRollbackReferenceV1(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; asset: MoviePublicationAssetV2 },
  budget: PublicationAuthorityReadBudget,
) {
  const operations = await tx.operation.findMany({
    where: {
      AND: [
        {
          result: {
            path: ["movieRollbackPhysicalV1", "receipt", "scope"],
            equals: input.scope,
          },
        },
        {
          result: {
            path: ["movieRollbackPhysicalV1", "receipt", "predecessor", "id"],
            equals: input.asset.id,
          },
        },
        {
          result: {
            path: [
              "movieRollbackPhysicalV1",
              "receipt",
              "predecessor",
              "version",
            ],
            equals: input.asset.version,
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(operations.length);
  if (operations.length === 0) return null;
  if (operations.length !== 1)
    throw new Error("Movie rollback publication authority is ambiguous");
  const operation = operations[0];
  if (operation === undefined)
    throw new Error("Movie rollback physical parent disappeared");
  const stored = z
    .object({
      movieRollbackIntentV1: z.object({
        intent: z.object({ invocation: MovieRollbackInvocationV1Schema }),
      }),
    })
    .parse(operation.result);
  const parent = await readMovieRollbackPhysicalV1(
    tx,
    stored.movieRollbackIntentV1.intent.invocation,
    budget,
  );
  if (
    parent?.asset.id !== input.asset.id ||
    parent.asset.version !== input.asset.version ||
    identityHash(parent.asset.scope) !== identityHash(input.scope) ||
    parent.asset.plexPublishedAt !== input.asset.plexPublishedAt ||
    parent.asset.rollbackExpiresAt !== input.asset.rollbackExpiresAt
  )
    throw new Error(
      "Movie rollback publication changed its exact version or original timestamps",
    );
  assertPublicationSnapshotSuccessor(
    { ...parent.asset, subtitles: input.asset.subtitles },
    input.asset,
  );
  const lineage = await compensationSubtitleLineage(
    tx,
    { baseline: parent.asset, current: input.asset, libraryKind: "movies" },
    budget,
  );
  return {
    ...parent.reference,
    ...(lineage.lineage === undefined
      ? {}
      : { subtitleLineage: lineage.lineage }),
  };
}
