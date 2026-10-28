import { z } from "zod";
import type { Prisma, Operation } from "#generated/prisma/client.ts";
import {
  MovieRestoreReferenceV1Schema,
  type MovieRestoreReferenceV1,
} from "#shared/movie-editions/publication-v2.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import type { MovieRestoreReceiptV1 } from "#shared/movie-editions/restore-v1.ts";
import { readMovieRestoreReceiptV1 } from "#infrastructure/movie-editions/retention/restore-commit.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

function restoreReference(receipt: MovieRestoreReceiptV1) {
  return MovieRestoreReferenceV1Schema.parse({
    kind: "movie_restore_publication_v1",
    scope: receipt.scope,
    operationId: receipt.input.operationId,
    receiptHash: identityHash(receipt),
    assetId: receipt.after.id,
    assetVersion: receipt.after.version,
    bindingHash: identityHash(receipt.after),
    physicalEvidenceHash: identityHash({
      participants: receipt.participants,
      journals: receipt.journals,
    }),
  });
}

export async function readMovieRestorePublicationParentV1(
  tx: Prisma.TransactionClient,
  operation: Operation,
  budget: PublicationAuthorityReadBudget,
) {
  const input = z.object(MovieOperationV4Schema.shape).parse(operation.payload);
  const receipt = await readMovieRestoreReceiptV1(tx, input, budget);
  if (receipt === null)
    throw new Error("Movie restore physical parent has no committed receipt");
  return {
    receipt,
    asset: receipt.after,
    reference: restoreReference(receipt),
  };
}

/** Historical consumers resolve the exact restore without querying current ownership. */
export async function loadMovieRestorePublicationParentV1(
  tx: Prisma.TransactionClient,
  reference: MovieRestoreReferenceV1,
  budget: PublicationAuthorityReadBudget,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: reference.operationId },
  });
  budget.consume(1);
  const parent = await readMovieRestorePublicationParentV1(
    tx,
    operation,
    budget,
  );
  const { subtitleLineage: _lineage, ...recorded } = reference;
  if (identityHash(recorded) !== identityHash(parent.reference))
    throw new Error(
      "Movie restore publication reference changed its exact parent",
    );
  return parent;
}
