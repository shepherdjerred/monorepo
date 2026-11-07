import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieRollbackReferenceV1Schema,
  type MovieRollbackReferenceV1,
} from "#shared/movie-editions/rollback/reference.ts";
import { MovieRollbackInvocationV1Schema } from "#shared/movie-editions/rollback/operation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRollbackPhysicalV1 } from "./records.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";

/** Discovery is exact to one current physical version and grants no current
 * consent. Other cuts and historical versions are never materialized. */
export async function findMovieRollbackPublicationParentV1(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; assetId: string; assetVersion: number },
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.operation.findMany({
    where: {
      AND: [
        {
          result: {
            path: ["movieRollbackIntentV1", "intent", "scope"],
            equals: input.scope,
          },
        },
        {
          result: {
            path: ["movieRollbackPhysicalV1", "receipt", "predecessor", "id"],
            equals: input.assetId,
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
            equals: input.assetVersion,
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row === undefined || rows.length !== 1)
    throw new Error("Movie rollback exact physical parent is ambiguous");
  const invocation = z
    .object({
      movieRollbackIntentV1: z.object({
        intent: z.object({ invocation: MovieRollbackInvocationV1Schema }),
      }),
    })
    .parse(row.result).movieRollbackIntentV1.intent.invocation;
  const parent = await readMovieRollbackPhysicalV1(tx, invocation, budget);
  if (
    parent?.operation.id !== row.id ||
    parent.asset.id !== input.assetId ||
    parent.asset.version !== input.assetVersion ||
    identityHash(parent.intent.scope) !== identityHash(input.scope)
  )
    throw new Error("Movie rollback lost its exact scoped physical parent");
  return parent;
}

/** Exact literal parent only; current caption lineage belongs to the finder. */
export async function loadMovieRollbackPublicationParentV1(
  tx: Prisma.TransactionClient,
  raw: MovieRollbackReferenceV1,
  budget: PublicationAuthorityReadBudget,
) {
  const reference = MovieRollbackReferenceV1Schema.parse(raw);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: reference.operationId },
  });
  budget.consume(1);
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
  const { subtitleLineage: _lineage, ...literal } = reference;
  if (
    parent === null ||
    identityHash(parent.reference) !== identityHash(literal)
  )
    throw new Error(
      "Movie rollback publication reference changed its actual immutable parent",
    );
  return parent;
}
