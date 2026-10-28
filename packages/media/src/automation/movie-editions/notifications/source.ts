import type { Prisma } from "#generated/prisma/client.ts";
import type {
  MovieAttemptOperationV4,
  MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieSubtitleCompletionV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import type { MovieSubtitleInstallV4 } from "#shared/movie-editions/subtitles-v4.ts";
import type { MovieNoticeV4 } from "#shared/movie-editions/notifications-v4.ts";
import { PlexPhysicalGroupSchema } from "#shared/plex-binding/contract.ts";
import { readMovieRestorePlexReceiptV1 } from "#infrastructure/movie-editions/retention/restore-plex-receipt.ts";

export async function readMovieNoticeProof(
  tx: Prisma.TransactionClient,
  payload: MovieNoticeV4,
  budget: PublicationAuthorityReadBudget,
) {
  if (payload.kind === "movie_publication")
    return readMovieNoticeSource(tx, payload.source, budget);
  return payload.kind === "movie_restoration"
    ? readMovieRestorationNoticeSource(tx, payload.source, budget)
    : readMovieCaptionNoticeSource(tx, payload.source, budget);
}

export async function readMovieRestorationNoticeSource(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const receipt = await readMovieRestorePlexReceiptV1(tx, input, budget);
  if (receipt === null)
    throw new Error("Movie restoration notice has no committed Plex rebinding");
  return {
    receipt,
    group: receipt.expected.newGroups[0],
    publicationHash: identityHash(receipt),
    eventKind: "media_available" as const,
  };
}

export async function readMovieCaptionNoticeSource(
  tx: Prisma.TransactionClient,
  input: MovieSubtitleInstallV4,
  budget: PublicationAuthorityReadBudget,
) {
  const completion = await readMovieSubtitleCompletionV4(tx, input, budget);
  if (completion === null)
    throw new Error("Movie caption notice has no actual installation receipt");
  const { asset, receipt } = completion;
  const coverage = asset.coverage.map(({ mediaId, edition }) => ({
    mediaId,
    edition,
  }));
  const group = PlexPhysicalGroupSchema.parse({
    assetId: asset.id,
    assetVersion: asset.version,
    checksum: asset.checksum,
    sizeBytes: asset.sizeBytes,
    canonicalPath: asset.path,
    ownershipEpoch: asset.ownershipEpoch,
    canonicalRootId: asset.editionRootId,
    edition: asset.edition,
    coverage,
    coverageHash: identityHash(coverage),
  });
  return {
    group,
    publicationHash: identityHash(receipt),
    eventKind: "subtitles_ready" as const,
  };
}

/** The producer and consumer resolve the real completed publication, not a serialized availability claim. */
export async function readMovieNoticeSource(
  tx: Prisma.TransactionClient,
  input: MovieAttemptOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const receipt = await readMoviePlexReceiptV2(tx, input, budget);
  if (receipt === null)
    throw new Error("Movie notification has no committed Plex publication");
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  budget.consume(1);
  const plan = MovieFilePlanSchema.parse(attempt.filePlan);
  const group = receipt.expected.newGroups[0];
  if (group === undefined)
    throw new Error(
      "Movie notification publication omitted its physical owner",
    );
  return {
    receipt,
    group,
    publicationHash: identityHash(receipt),
    eventKind:
      plan.entries[0].previousAssetId === null
        ? ("media_available" as const)
        : ("media_upgraded" as const),
  };
}
