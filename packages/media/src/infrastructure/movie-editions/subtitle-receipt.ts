import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieSubtitleInstallV4 } from "#shared/movie-editions/subtitles-v4.ts";
import {
  movieSubtitleTargetV4,
  MovieSubtitleOperationV4Schema,
} from "#shared/movie-editions/subtitles-v4.ts";
import {
  MovieSubtitleReceiptV4Schema,
  type MovieSubtitleReceiptV4,
} from "#shared/movie-editions/subtitle-receipt-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { loadMoviePublicationV2 } from "./publication/records.ts";
import { loadMovieLibraryParentV2 } from "./library-records.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import type { MoviePublicationOutcomeV2 } from "#shared/movie-editions/publication-v2.ts";
import { loadMovieRestorePublicationParentV1 } from "./publication/restore-records.ts";

/** Completed ACKs read original immutable parents before dynamic configuration or current target state. */
export async function readMovieSubtitleReceiptV4(
  tx: Prisma.TransactionClient,
  input: MovieSubtitleInstallV4,
  budget: PublicationAuthorityReadBudget,
) {
  const completion = await readMovieSubtitleCompletionV4(tx, input, budget);
  return completion?.receipt ?? null;
}

/** Retain the validated physical parent instead of traversing it again for a downstream effect. */
export async function readMovieSubtitleCompletionV4(
  tx: Prisma.TransactionClient,
  input: MovieSubtitleInstallV4,
  budget: PublicationAuthorityReadBudget,
) {
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const raw = z
    .object({ movieSubtitleReceiptV4: z.unknown().optional() })
    .nullable()
    .parse(command.result)?.movieSubtitleReceiptV4;
  if (raw === undefined) return null;
  const envelope = z
    .strictObject({ receipt: z.json(), receiptHash: z.string() })
    .parse(raw);
  const receipt = parsePlexRecord(
    MovieSubtitleReceiptV4Schema,
    envelope.receipt,
    envelope.receiptHash,
  );
  const recorded = z
    .object(MovieSubtitleOperationV4Schema.shape)
    .parse(command.payload);
  if (
    identityHash(nativeJson(receipt.input)) !==
      identityHash(nativeJson(input)) ||
    identityHash(nativeJson(recorded)) !==
      identityHash(nativeJson(receipt.target)) ||
    receipt.command.kind !== command.kind ||
    receipt.command.targetId !== command.targetId ||
    receipt.command.payloadHash !== identityHash(command.payload)
  )
    throw new Error("Movie subtitle completion command changed");
  const asset = await assertReceiptParent(tx, receipt, budget);
  assertMovieSubtitleReceiptV4(receipt);
  return { receipt, asset };
}

async function assertReceiptParent(
  tx: Prisma.TransactionClient,
  receipt: MovieSubtitleReceiptV4,
  budget: PublicationAuthorityReadBudget,
) {
  const reference = receipt.publication;
  if (reference.kind === "movie_restore_publication_v1") {
    const parent = await loadMovieRestorePublicationParentV1(
      tx,
      reference,
      budget,
    );
    if (
      parent.asset.id !== receipt.input.assetId ||
      parent.asset.path !== receipt.videoPath ||
      parent.asset.version !== receipt.after.videoVersion ||
      parent.asset.checksum !== receipt.after.videoChecksum
    )
      throw new Error(
        "Movie subtitle completion lost its actual restored physical parent",
      );
    return parent.asset;
  }
  if (reference.kind === "movie_library_adoption_v2") {
    const parent = await loadMovieLibraryParentV2(
      tx,
      { receiptId: reference.receiptId, assetId: reference.assetId },
      budget,
    );
    const { subtitleLineage: _lineage, ...recorded } = reference;
    if (
      identityHash(nativeJson(recorded)) !==
        identityHash(nativeJson(parent.reference)) ||
      parent.asset.path !== receipt.videoPath ||
      parent.asset.version !== receipt.after.videoVersion ||
      parent.asset.checksum !== receipt.after.videoChecksum
    )
      throw new Error(
        "Movie subtitle completion lost its actual initial library parent",
      );
    return parent.asset;
  }
  const row = await tx.mediaPublicationTransition.findUniqueOrThrow({
    where: { id: reference.transitionId },
  });
  budget.consume(1);
  const parent = await loadMoviePublicationV2(tx, row.attemptId, budget);
  if (parent === null || parent.outcome?.kind !== "published")
    throw new Error("Movie subtitle completion publication is not committed");
  assertReceiptPublication(
    receipt,
    parent.outcome,
    parent.reference.intentHash,
    parent.outcomeHash,
  );
  const asset = parent.outcome.entries[0].successor;
  if (asset === null) throw new Error("Movie caption parent has no successor");
  return asset;
}

function assertReceiptPublication(
  receipt: MovieSubtitleReceiptV4,
  outcome: MoviePublicationOutcomeV2,
  intentHash: string,
  outcomeHash: string | null,
) {
  const reference = receipt.publication;
  if (reference.kind !== "movie_publication_transition_v2")
    throw new Error("Expected an actual movie acquisition publication");
  const result = outcome.entries[0];
  const asset = result.successor;
  if (
    asset == null ||
    outcomeHash !== reference.outcomeHash ||
    intentHash !== reference.intentHash ||
    asset.id !== receipt.input.assetId ||
    asset.version !== receipt.after.videoVersion ||
    asset.version !== receipt.publication.assetVersion ||
    asset.path !== receipt.videoPath ||
    asset.checksum !== receipt.after.videoChecksum ||
    identityHash(nativeJson(asset.scope)) !==
      identityHash(nativeJson(receipt.input.scope)) ||
    receipt.publication.bindingHash !== identityHash(nativeJson(asset)) ||
    receipt.publication.physicalEvidenceHash !==
      identityHash(
        nativeJson({
          effects: outcome.effects,
          participants: result.participants,
          journals: result.journals,
        }),
      )
  )
    throw new Error(
      "Movie subtitle completion lost its actual physical publication",
    );
}

export function assertMovieSubtitleReceiptV4(receipt: MovieSubtitleReceiptV4) {
  const { input, target, before, after } = receipt;
  if (
    target.operationId !== input.operationId ||
    target.assetId !== input.assetId ||
    identityHash(nativeJson(target.scope)) !==
      identityHash(nativeJson(input.scope)) ||
    after.id !== input.subtitleId ||
    after.assetId !== input.assetId ||
    receipt.command.targetId !== input.assetId ||
    after.ownershipEpoch !== target.recoveryEpoch ||
    after.language !== target.language ||
    (target.forced !== undefined && after.forced !== target.forced) ||
    (target.hearingImpaired === "required" && after.hearingImpaired !== true) ||
    (target.hearingImpaired === "excluded" &&
      after.hearingImpaired !== false) ||
    receipt.publication.assetId !== input.assetId ||
    identityHash(nativeJson(receipt.publication.scope)) !==
      identityHash(nativeJson(input.scope))
  )
    throw new Error(
      "Movie subtitle completion lost its exact target, extraction or journal",
    );
  assertCaptionTransition(before, after);
  assertInstallationEvidence(receipt);
  assertInstallationJournal(receipt);
  assertInstallationDeadline(receipt);
}

function assertInstallationEvidence(receipt: MovieSubtitleReceiptV4) {
  const { input, target, before, after } = receipt;
  const expected = {
    ...z.record(z.string(), z.json()).parse(before.matchingEvidence),
    schemaVersion: 4,
    movieScope: input.scope,
    targetAuthority: target.targetAuthority,
    target: movieSubtitleTargetV4(target),
    movieInstallationV4: { schemaVersion: 4, operationId: input.operationId },
  };
  if (
    identityHash(nativeJson(expected)) !== identityHash(after.matchingEvidence)
  )
    throw new Error("Movie subtitle completion target authority changed");
}

function assertCaptionTransition(
  before: MovieSubtitleReceiptV4["before"],
  after: MovieSubtitleReceiptV4["after"],
) {
  const {
    version,
    state,
    path,
    provenance,
    matchingEvidence: _beforeEvidence,
    ...original
  } = before;
  const {
    version: installedVersion,
    state: _installedState,
    path: _installedPath,
    provenance: _installedProvenance,
    matchingEvidence: _installedEvidence,
    ...installed
  } = after;
  if (
    version !== 0 ||
    installedVersion !== 1 ||
    state !== "validated" ||
    path !== null ||
    before.storageKind !== "sidecar" ||
    before.qualityStatus !== "accepted" ||
    after.checksum === null ||
    after.checksum !== after.contentChecksum ||
    identityHash(nativeJson(original)) !==
      identityHash(nativeJson(installed)) ||
    identityHash(nativeJson(after.provenance)) !==
      identityHash(
        nativeJson({
          ...z.record(z.string(), z.json()).parse(provenance),
          checksum: after.checksum,
        }),
      )
  )
    throw new Error(
      "Movie subtitle installation changed its captured bytes or caption facts",
    );
}

function assertInstallationJournal(receipt: MovieSubtitleReceiptV4) {
  const { input, after, journal } = receipt;
  const provenance = z
    .object({
      format: z.enum(["srt", "ass", "ssa", "vtt"]),
      checksum: z.string(),
    })
    .parse(after.provenance);
  if (
    provenance.checksum !== after.checksum ||
    journal.sha256 !== after.checksum ||
    journal.operationId !== input.operationId ||
    journal.target !== after.path ||
    journal.source !==
      `/data/movies/.media-control/subtitles/${after.id}.${provenance.format}` ||
    subtitleDestination({
      videoPath: receipt.videoPath,
      language: after.language,
      forced: after.forced,
      hearingImpaired: after.hearingImpaired,
      format: provenance.format,
    }) !== after.path
  )
    throw new Error("Movie subtitle completion path changed");
}

function assertInstallationDeadline(receipt: MovieSubtitleReceiptV4) {
  const observed = Date.parse(receipt.observedAt);
  const committed = Date.parse(receipt.committedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (
    committed < observed ||
    committed >= expires ||
    expires > Math.min(Date.parse(receipt.sdkExpiresAt), observed + 60_000)
  )
    throw new Error("Movie subtitle completion original invocation changed");
}
