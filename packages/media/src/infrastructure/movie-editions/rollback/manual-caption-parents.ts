import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeSubtitleSnapshot } from "#shared/native-subtitles.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  MovieReplacementSnapshotV2Schema,
  MovieReplacementReceiptV2Schema,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { MovieSubtitleReceiptV4Schema } from "#shared/movie-editions/subtitle-receipt-v4.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import type {
  MoviePublicationAssetV2,
  MoviePublicationReferenceV2,
} from "#shared/movie-editions/publication-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { assertMovieReplacementReceiptTransitionV2 } from "#infrastructure/movie-editions/subtitle-replacement/receipt-validation.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";

/** Only immediate actual immutable caption parents are materialized here.
 * Their original births already closed ancestry; the caller separately holds
 * and validates complete current B inventory/physical grant/owner authority. */
export async function captureRequestedMovieRollbackCaptionParentV1(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    caption: NativeSubtitleSnapshot;
    baseline: MoviePublicationAssetV2;
    publication: MoviePublicationReferenceV2;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const markers = z
    .object({
      movieReplacementV2: z
        .strictObject({ schemaVersion: z.literal(2), replacementId: z.uuid() })
        .optional(),
      movieInstallationV4: z
        .strictObject({ schemaVersion: z.literal(4), operationId: z.uuid() })
        .optional(),
    })
    .parse(input.caption.matchingEvidence);
  if (markers.movieReplacementV2 !== undefined)
    return readReplacement(
      tx,
      input,
      markers.movieReplacementV2.replacementId,
      budget,
    );
  if (markers.movieInstallationV4 !== undefined)
    return readInstallation(
      tx,
      input,
      markers.movieInstallationV4.operationId,
      budget,
    );
  if (
    !input.baseline.subtitles.some(
      (caption) => identityHash(caption) === identityHash(input.caption),
    )
  )
    throw new FileGuardError("movie_rollback_successor_caption_parent_missing");
  return {
    source: { kind: "video_baseline" as const, publication: input.publication },
    publication: input.publication,
  };
}

type Input = Parameters<typeof captureRequestedMovieRollbackCaptionParentV1>[1];

async function readInstallation(
  tx: Prisma.TransactionClient,
  input: Input,
  operationId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  budget.consume(1);
  const marker = z
    .object({
      movieSubtitleReceiptV4: z.strictObject({
        receipt: MovieSubtitleReceiptV4Schema,
        receiptHash: z.string(),
      }),
    })
    .parse(command.result).movieSubtitleReceiptV4;
  const receipt = parsePlexRecord(
    MovieSubtitleReceiptV4Schema,
    marker.receipt,
    marker.receiptHash,
  );
  const envelopeTarget = MovieSubtitleOperationV4Schema.extend({
    kind: z.literal("acquire_movie_subtitles_v4"),
  }).parse(command.payload);
  const { kind: _kind, ...target } = envelopeTarget;
  if (
    command.kind !== "acquire_movie_subtitles_v4" ||
    command.targetId !== input.caption.assetId ||
    receipt.command.targetId !== command.targetId ||
    receipt.command.payloadHash !== identityHash(command.payload) ||
    receipt.input.operationId !== command.id ||
    receipt.input.assetId !== input.caption.assetId ||
    receipt.input.subtitleId !== input.caption.id ||
    identityHash(receipt.input.scope) !== identityHash(input.scope) ||
    identityHash(receipt.target) !== identityHash(target) ||
    identityHash(receipt.after) !== identityHash(input.caption)
  )
    throw new Error(
      "Manual rollback caption lost its actual immutable installation parent",
    );
  assertSourceVideo(receipt.publication, input);
  return {
    publication: receipt.publication,
    source: {
      kind: "installation_v4" as const,
      input: receipt.input,
      receiptHash: marker.receiptHash,
    },
  };
}

async function readReplacement(
  tx: Prisma.TransactionClient,
  input: Input,
  replacementId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const row = await tx.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { receipt: true },
  });
  budget.consume(row.receipt === null ? 1 : 2);
  if (row.receipt?.outcome !== "installed")
    throw new Error(
      "Manual rollback caption replacement has no actual installed receipt",
    );
  const snapshot = MovieReplacementSnapshotV2Schema.parse(row.snapshot);
  const receipt = MovieReplacementReceiptV2Schema.parse(row.receipt.evidence);
  if (
    identityHash(snapshot) !== row.snapshotHash ||
    receipt.snapshotHash !== row.snapshotHash ||
    row.assetId !== input.caption.assetId ||
    row.candidateSubtitleId !== input.caption.id ||
    receipt.candidateSubtitleId !== input.caption.id ||
    identityHash(snapshot.scope) !== identityHash(input.scope) ||
    identityHash(receipt.scope) !== identityHash(input.scope) ||
    identityHash(receipt.after.candidate) !== identityHash(input.caption)
  )
    throw new Error(
      "Manual rollback caption lost its actual immutable replacement parent",
    );
  assertMovieReplacementReceiptTransitionV2(
    { ...row, receipt: row.receipt },
    snapshot,
    receipt,
  );
  assertSourceVideo(snapshot.publication, input);
  return {
    publication: snapshot.publication,
    source: {
      kind: "replacement_v2" as const,
      replacementId: row.id,
      receiptId: row.receipt.id,
      receiptHash: identityHash(row.receipt.evidence),
    },
  };
}

function assertSourceVideo(
  publication: MoviePublicationReferenceV2,
  input: Input,
) {
  const { subtitleLineage: _lineage, ...source } = publication;
  const { subtitleLineage: _baselineLineage, ...baseline } = input.publication;
  if (
    identityHash(source) !== identityHash(baseline) ||
    publication.assetId !== input.caption.assetId ||
    publication.assetVersion !== input.caption.videoVersion ||
    input.caption.videoChecksum !== input.baseline.checksum ||
    input.caption.ownershipEpoch !== input.baseline.ownershipEpoch ||
    identityHash(publication.scope) !== identityHash(input.scope)
  )
    throw new Error(
      "Manual rollback caption belongs to another physical video source",
    );
}
