import { z } from "zod";
import type { Prisma, SubtitleAsset } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { SubtitleMatchScoreV1Schema } from "#shared/subtitle-maintenance/score.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function movieReplacementCandidateSourceV1(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof automaticMovieCandidateSourceV1>[1],
  budget: PublicationAuthorityReadBudget,
) {
  const markers = z
    .object({
      movieManualReplacementV2: z
        .strictObject({ schemaVersion: z.literal(2), eventId: z.uuid() })
        .optional(),
      automaticSubtitleUpgradeV1: z
        .strictObject({ schemaVersion: z.literal(1), eventId: z.uuid() })
        .optional(),
    })
    .parse(input.candidate.matchingEvidence);
  if (
    (markers.movieManualReplacementV2 === undefined) ===
    (markers.automaticSubtitleUpgradeV1 === undefined)
  )
    throw new FileGuardError("subtitle_candidate_source_ambiguous");
  const automatic = markers.movieManualReplacementV2 === undefined;
  let event;
  if (markers.movieManualReplacementV2 === undefined)
    event = await automaticMovieCandidateSourceV1(tx, input, budget);
  else {
    event = await tx.applicationEvent.findUniqueOrThrow({
      where: { id: markers.movieManualReplacementV2.eventId },
    });
    budget.consume(1);
  }
  const source = z
    .object({
      subtitleId: z.literal(input.candidate.id),
      oldSubtitleId: z.literal(input.old.id),
      assetId: z.literal(input.assetId),
      checksum: z.literal(input.candidate.checksum),
      scope: z.json(),
    })
    .parse(event.payload);
  if (
    event.kind !==
      (automatic
        ? "subtitle_automatic_upgrade_candidate_v1"
        : "movie_subtitle_replacement_candidate_v2") ||
    event.actorId === null ||
    identityHash(source.scope) !== identityHash(nativeJson(input.scope))
  )
    throw new Error(
      "Movie replacement candidate lost its actual immutable source",
    );
  return event;
}

/** Provider-origin candidates keep their real operation and event ancestry.
 * They never acquire the manual-upload marker or a fabricated provider ID. */
export async function automaticMovieCandidateSourceV1(
  tx: Prisma.TransactionClient,
  input: {
    candidate: SubtitleAsset;
    old: SubtitleAsset;
    scope: MovieEditionScope;
    assetId: string;
    targetAuthority: string;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const evidence = z
    .object({
      operationId: z.uuid(),
      automaticSubtitleUpgradeV1: z.strictObject({
        schemaVersion: z.literal(1),
        eventId: z.uuid(),
      }),
    })
    .parse(input.candidate.matchingEvidence);
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: evidence.automaticSubtitleUpgradeV1.eventId },
  });
  const body = z
    .object({
      operationId: z.literal(evidence.operationId),
      subtitleId: z.literal(input.candidate.id),
      oldSubtitleId: z.literal(input.old.id),
      oldVersion: z.literal(input.old.version),
      assetId: z.literal(input.assetId),
      checksum: z.literal(input.candidate.checksum),
      scope: z.json(),
      targetAuthority: z.literal(input.targetAuthority),
      oldScore: SubtitleMatchScoreV1Schema,
      score: SubtitleMatchScoreV1Schema,
    })
    .parse(event.payload);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: body.operationId },
  });
  budget.consume(2);
  const claim = z
    .object({
      subtitleDownload: z.object({
        eventId: z.uuid(),
        requestedAt: z.iso.datetime(),
        providerId: z.literal(input.candidate.providerId),
        candidateId: z.string().min(1),
      }),
    })
    .parse(operation.result);
  const download = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: claim.subtitleDownload.eventId },
  });
  budget.consume(1);
  z.object({
    operationId: z.literal(operation.id),
    providerId: z.literal(input.candidate.providerId),
    candidateId: z.literal(claim.subtitleDownload.candidateId),
    requestedAt: z.literal(claim.subtitleDownload.requestedAt),
  }).parse(download.payload);
  if (
    event.kind !== "subtitle_automatic_upgrade_candidate_v1" ||
    download.kind !== "subtitle_download_requested" ||
    event.actorId === null ||
    operation.kind !== "acquire_movie_subtitles_v4" ||
    operation.targetId !== input.assetId ||
    identityHash(body.scope) !== identityHash(nativeJson(input.scope)) ||
    body.score.kind !== body.oldScore.kind ||
    body.score.referenceHash !== body.oldScore.referenceHash ||
    body.score.score <= body.oldScore.score ||
    claim.subtitleDownload.candidateId.length === 0
  )
    throw new FileGuardError("subtitle_automatic_candidate_parent_changed");
  return event;
}
