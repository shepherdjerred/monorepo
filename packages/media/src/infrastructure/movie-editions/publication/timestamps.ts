import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  MoviePublicationAssetV2,
  MovieTransitionReferenceV2,
} from "#shared/movie-editions/publication-v2.ts";
import {
  MoviePlexReceiptV2Schema,
  type MoviePlexReceiptV2,
} from "#shared/movie-editions/plex-v2.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

type MovieTimestampInput = {
  baseline: MoviePublicationAssetV2;
  current: MoviePublicationAssetV2;
  successor: MoviePublicationAssetV2 | null;
  publication: Pick<
    MovieTransitionReferenceV2,
    "transitionId" | "intentHash" | "outcomeHash"
  >;
};

/** A write-once timestamp follows an actual immutable Plex completion, never an arbitrary metadata edit. */
export async function assertMoviePublicationTimesV2(
  tx: Prisma.TransactionClient,
  input: MovieTimestampInput,
  budget: PublicationAuthorityReadBudget,
) {
  const { baseline, current } = input;
  if (
    baseline.plexPublishedAt === current.plexPublishedAt &&
    baseline.rollbackExpiresAt === current.rollbackExpiresAt
  )
    return;
  const published = current.state === "published" ? current : input.successor;
  if (published === null)
    throw new Error("Movie publication timestamp successor missing");
  const rows = await tx.operation.findMany({
    where: {
      result: {
        path: ["moviePlexReceiptV2", "receipt", "publication", "transitionId"],
        equals: input.publication.transitionId,
      },
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length !== 1)
    throw new Error(
      "Movie publication timestamp lacks one exact Plex completion",
    );
  const row = rows[0];
  if (row === undefined)
    throw new Error("Movie Plex timestamp receipt disappeared");
  const envelope = z
    .object({
      moviePlexReceiptV2: z.strictObject({
        receipt: z.json(),
        receiptHash: z.string(),
      }),
    })
    .parse(row.result).moviePlexReceiptV2;
  const receipt = parsePlexRecord(
    MoviePlexReceiptV2Schema,
    envelope.receipt,
    envelope.receiptHash,
  );
  const association = receipt.observation.associations[0];
  assertMovieTimestampPlexParent(receipt, row.id, input, published);
  const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: receipt.binding.evidenceId },
  });
  budget.consume(1);
  if (
    evidence.associationHash !== receipt.binding.associationHash ||
    identityHash(
      parsePlexRecord(
        PlexMovieAssociationV2Schema,
        evidence.evidence,
        evidence.associationHash,
      ),
    ) !== identityHash(association)
  )
    throw new Error("Movie publication timestamp association changed");
  if (current.state === "published") {
    if (current.plexPublishedAt !== receipt.publishedAt)
      throw new Error("Movie publication verified timestamp changed");
    return;
  }
  const cleanup = await tx.upgradeCleanup.findUnique({
    where: {
      assetId_successorAssetId: {
        assetId: current.id,
        successorAssetId: published.id,
      },
    },
  });
  budget.consume(cleanup === null ? 0 : 1);
  const expected = new Date(
    Date.parse(receipt.publishedAt) + 7 * 86_400_000,
  ).toISOString();
  if (
    current.rollbackExpiresAt !== expected ||
    cleanup?.expiresAt.toISOString() !== expected ||
    cleanup.recoveryEpoch !== current.ownershipEpoch
  )
    throw new Error(
      "Movie publication rollback timestamp lacks its exact verified successor cleanup",
    );
}

function assertMovieTimestampPlexParent(
  receipt: MoviePlexReceiptV2,
  operationId: string,
  input: MovieTimestampInput,
  published: MoviePublicationAssetV2,
) {
  const association = receipt.observation.associations[0];
  if (
    receipt.input.operationId !== operationId ||
    identityHash(receipt.publication) !== identityHash(input.publication) ||
    receipt.input.scope.mediaId !== input.current.scope.mediaId ||
    receipt.input.scope.edition !== input.current.scope.edition ||
    association.group.assetId !== published.id ||
    association.group.assetVersion !== published.version ||
    association.group.checksum !== published.checksum ||
    association.group.canonicalPath !== published.path
  )
    throw new Error("Movie publication timestamp Plex parent changed");
}
