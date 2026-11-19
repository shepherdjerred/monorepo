import { z } from "zod";
import type { Prisma, SubtitleAsset } from "#generated/prisma/client.ts";
import type {
  MovieSubtitleInstallV4,
  MovieSubtitleOperationV4,
} from "#shared/movie-editions/subtitles-v4.ts";
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
import { loadMovieRollbackPublicationParentV1 } from "./rollback/parent.ts";
import {
  regularDialogueCovered,
  SubtitleSpeechProofSchema,
} from "#domain/subtitle-speech.ts";

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
  if (reference.kind === "movie_rollback_publication_v1") {
    const parent = await loadMovieRollbackPublicationParentV1(
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
        "Movie subtitle completion lost its actual rolled-back physical parent",
      );
    return parent.asset;
  }
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
  const { input, target, after } = receipt;
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
    !matchesReceiptForcedTarget(receipt) ||
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
  assertCaptionTransition(receipt);
  assertInstallationEvidence(receipt);
  assertInstallationJournal(receipt);
  assertInstallationDeadline(receipt);
}

function matchesReceiptForcedTarget({ target, after }: MovieSubtitleReceiptV4) {
  if (target.forced === undefined || after.forced === target.forced)
    return true;
  const evidence = z
    .object({ regularDialogueV1: z.unknown() })
    .safeParse(after.matchingEvidence);
  return (
    !target.forced &&
    after.forced === null &&
    ["en", "zh-CN", "zh-Hans"].includes(target.language) &&
    evidence.success &&
    regularDialogueCovered(
      evidence.data.regularDialogueV1,
      after.videoChecksum,
      after.checksum,
    )
  );
}

/** Reject a forged prepared stage before an installer can publish a sidecar. */
export function assertMovieSubtitleCandidateVersionV4(
  caption: SpeechCandidate,
  target: MovieSubtitleOperationV4,
) {
  if (
    caption.version !== 0 &&
    !(caption.version === 1 && preparedCaptionProof(caption, target))
  )
    throw new Error("Movie subtitle candidate preparation changed");
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

function assertCaptionTransition({
  before,
  after,
  target,
}: MovieSubtitleReceiptV4) {
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
    state !== "validated" ||
    path !== null ||
    before.storageKind !== "sidecar" ||
    before.qualityStatus !== "accepted" ||
    after.checksum === null ||
    after.checksum !== after.contentChecksum ||
    !(
      (version === 0 && installedVersion === 1) ||
      (version === 1 &&
        installedVersion === 2 &&
        preparedCaptionProof(before, target))
    ) ||
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

/** Only the one measured candidate transition may precede installation. */
type SpeechCandidate = Pick<
  SubtitleAsset,
  | "version"
  | "matchingEvidence"
  | "videoChecksum"
  | "videoVersion"
  | "checksum"
  | "ownershipEpoch"
  | "forced"
  | "language"
>;

function preparedCaptionProof(
  caption: SpeechCandidate,
  target: MovieSubtitleOperationV4,
) {
  const parsed = z
    .object({
      schemaVersion: z.literal(4),
      operationId: z.literal(target.operationId),
      targetAuthority: z.literal(target.targetAuthority),
      movieScope: z.object({
        rootMediaId: z.literal(target.scope.rootMediaId),
        mediaId: z.literal(target.scope.mediaId),
        edition: z.literal(target.scope.edition),
      }),
      assetVersion: z.literal(caption.videoVersion),
      assetChecksum: z.literal(caption.videoChecksum),
      recoveryEpoch: z.literal(caption.ownershipEpoch),
      regularDialogueRequiredV1: z.boolean().optional(),
      regularDialogueV1: SubtitleSpeechProofSchema,
      timingAlignedV1: z.strictObject({
        schemaVersion: z.literal(1),
        videoChecksum: z.literal(caption.videoChecksum),
        subtitleChecksum: z.literal(caption.checksum),
        engine: z.literal("ffsubsync-0.5.1"),
        maxOffsetSeconds: z.literal(60),
        goldenSectionRequested: z.literal(true),
        fixFrameRate: z.literal(false),
      }),
    })
    .safeParse(caption.matchingEvidence);
  if (!parsed.success) return false;
  const proof = parsed.data.regularDialogueV1;
  return (
    proof.videoChecksum === caption.videoChecksum &&
    proof.subtitleChecksum === caption.checksum &&
    proof.speechMs <= proof.runtimeMs &&
    proof.coveredSpeechMs <= proof.speechMs &&
    proof.windows.every((w) => w.coveredSpeechMs <= w.speechMs) &&
    proof.windows.reduce((n, w) => n + w.speechMs, 0) === proof.speechMs &&
    proof.windows.reduce((n, w) => n + w.coveredSpeechMs, 0) ===
      proof.coveredSpeechMs &&
    (!(
      parsed.data.regularDialogueRequiredV1 === true ||
      (target.forced === false && caption.forced === null)
    ) ||
      regularDialogueCovered(proof, caption.videoChecksum, caption.checksum))
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
