import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { FileGuardError } from "./types.ts";
import type { ReleaseAttributes, QualityProfile } from "#shared/contract.ts";
import type { ReleaseEvaluation } from "#domain/release-evaluation.ts";
import { definitiveMeasuredRejection } from "#domain/content-rejection.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import { queueOperation } from "#automation/store.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export class MeasuredContentRejection extends FileGuardError {
  constructor(
    readonly evidence: {
      schemaVersion: 1;
      releaseId: string;
      mediaId: string;
      profileId: string;
      profileVersion: number;
      reasons: string[];
      measured: {
        quality: string;
        codec: string;
        audioLanguages: string[];
        sizeBytes: number;
      };
    },
  ) {
    super("measured_quality_rejected");
  }
}

export function measuredQualityError(
  measured: ReleaseAttributes,
  profile: QualityProfile,
  mediaId: string,
  evaluation: ReleaseEvaluation,
) {
  return definitiveMeasuredRejection(
    evaluation.reasons,
    measured.audioLanguages,
    measured.codec,
  )
    ? new MeasuredContentRejection({
        schemaVersion: 1,
        releaseId: measured.id,
        mediaId,
        profileId: profile.id,
        profileVersion: profile.version,
        reasons: evaluation.reasons,
        measured: {
          quality: measured.quality,
          codec: measured.codec,
          audioLanguages: [...measured.audioLanguages],
          sizeBytes: measured.sizeBytes,
        },
      })
    : new FileGuardError("measured_quality_rejected");
}

/** Caller has rechecked native acquisition authority and owns its complete target locks.
 * Only an unstaged, known completed download can release reservations; its torrent and obligations remain intact. */
export async function rejectUnstagedContentV1(
  tx: Prisma.TransactionClient,
  attemptId: string,
  error: MeasuredContentRejection,
  budget?: PublicationAuthorityReadBudget,
) {
  budget?.consume(3);
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { release: true, torrent: true },
  });
  if (!unstagedRejectionEligible(attempt, error)) return false;
  const observation = z
    .object({ torrent: z.object({ progress: z.literal(1) }) })
    .safeParse(attempt.torrent?.observation);
  if (!observation.success) return false;
  const rejection = {
    ...error.evidence,
    releaseDigest: candidateDigest(attempt.release),
    rejectedAt: new Date().toISOString(),
  };
  await tx.acquisitionAttempt.update({
    where: { id: attempt.id },
    data: {
      state: "rejected",
      failure: {
        ...z.record(z.string(), z.json()).parse(attempt.failure),
        contentRejectionV1: rejection,
      },
    },
  });
  await tx.acquisitionReservation.deleteMany({
    where: {
      attemptId: attempt.id,
      edition: attempt.edition,
      mediaId: { in: attempt.mediaIds },
    },
  });
  await tx.applicationEvent.upsert({
    where: { dedupeKey: `content-rejection:${attempt.id}` },
    create: {
      dedupeKey: `content-rejection:${attempt.id}`,
      mediaId: error.evidence.mediaId,
      kind: "release_content_rejected",
      payload: rejection,
    },
    update: {},
  });
  for (const mediaId of attempt.mediaIds) {
    budget?.consume(1);
    const target = await tx.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId, edition: attempt.edition } },
    });
    if (
      !target.desiredPresence ||
      !target.monitoring ||
      target.intentionallyRemovedAt !== null ||
      target.automationEpoch !== attempt.recoveryEpoch
    )
      continue;
    const movie = attempt.movieEditionAuthority !== null;
    await queueOperation(tx, {
      ...(budget === undefined ? {} : { budget }),
      key: `content-rejection:${attempt.id}:${mediaId}:${String(target.generation)}`,
      kind: movie ? "reconcile_movie_edition_v4" : "reconcile_media",
      targetId: mediaId,
      payload: {
        mediaId,
        generation: target.generation,
        ...(movie
          ? {
              schemaVersion: 4,
              scope: {
                mediaId,
                rootMediaId: target.editionRootId ?? mediaId,
                edition: target.edition,
              },
            }
          : {}),
      },
    });
  }
  return true;
}

function unstagedRejectionEligible(
  attempt: Prisma.AcquisitionAttemptGetPayload<{
    include: { release: true; torrent: true };
  }>,
  error: MeasuredContentRejection,
) {
  const captured = z
    .object({ profileId: z.string(), profileVersion: z.int().nonnegative() })
    .safeParse(attempt.failure);
  return (
    attempt.filePlan === null &&
    ["downloading", "validating"].includes(attempt.state) &&
    attempt.torrent?.owned === true &&
    attempt.releaseId === error.evidence.releaseId &&
    attempt.mediaIds.includes(error.evidence.mediaId) &&
    captured.success &&
    captured.data.profileId === error.evidence.profileId &&
    captured.data.profileVersion === error.evidence.profileVersion &&
    attempt.release.sourceEvidence !== null
  );
}
