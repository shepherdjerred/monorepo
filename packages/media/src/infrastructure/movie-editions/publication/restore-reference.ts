import type { Prisma } from "#generated/prisma/client.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertPublicationSnapshotSuccessor } from "#infrastructure/publication-proof/authority.ts";
import { compensationSubtitleLineage } from "#infrastructure/native-compensation/subtitle-lineage.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRestorePublicationParentV1 } from "./restore-records.ts";

/** A new restore is an exact physical version, never an extension of an old acquisition snapshot. */
export async function findMovieRestoreReferenceV1(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; asset: MoviePublicationAssetV2 },
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.operation.findMany({
    where: {
      kind: "restore_movie_edition_v4",
      AND: [
        {
          result: {
            path: ["movieRestoreReceiptV1", "receipt", "scope"],
            equals: input.scope,
          },
        },
        {
          result: {
            path: ["movieRestoreReceiptV1", "receipt", "after", "id"],
            equals: input.asset.id,
          },
        },
        {
          result: {
            path: ["movieRestoreReceiptV1", "receipt", "after", "version"],
            equals: input.asset.version,
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length === 0) return null;
  if (rows.length !== 1)
    throw new Error("Movie restored publication authority is ambiguous");
  const operation = rows[0];
  if (operation === undefined)
    throw new Error("Movie restore parent disappeared");
  const parent = await readMovieRestorePublicationParentV1(
    tx,
    operation,
    budget,
  );
  if (
    identityHash(parent.receipt.scope) !== identityHash(input.scope) ||
    parent.asset.id !== input.asset.id ||
    parent.asset.version !== input.asset.version ||
    parent.asset.plexPublishedAt !== input.asset.plexPublishedAt ||
    parent.asset.rollbackExpiresAt !== input.asset.rollbackExpiresAt
  )
    throw new Error(
      "Movie restore publication changed its exact version or original timestamps",
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
