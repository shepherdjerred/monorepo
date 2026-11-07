import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { queueMovieNoticesV4 } from "./queue.ts";
import { readMovieReplacementCaptionNoticeSourceV2 } from "./replacement-source.ts";

/** Readiness uses the same logical cohort dedupe as ordinary actual caption installation. */
export async function queueReadyMovieReplacementCaptionsV2(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    assetId: string;
    subtitleId: string;
    replacementId: string;
    epoch: number;
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  // Settlement always validates the complete actual receipt chain exactly once,
  // including when current readiness or serving authority prevents a notice.
  const source = {
    schemaVersion: 2 as const,
    scope: input.scope,
    assetId: input.assetId,
    subtitleId: input.subtitleId,
    replacementId: input.replacementId,
  };
  const proof = await readMovieReplacementCaptionNoticeSourceV2(
    tx,
    source,
    budget,
  );
  const work = await currentMovieSubtitleWorkV4(tx, input, budget);
  if (
    work.protectedReasons.length > 0 ||
    work.targets.length === 0 ||
    !subtitleTargetsReady(work, input.epoch)
  )
    return { queued: 0, guards: [work.freshness] };
  budget.consume(2);
  const binding = await readCurrentPlexBinding(tx, {
    scope: { mediaId: input.scope.mediaId, edition: input.scope.edition },
    assetId: input.assetId,
    access: {
      serverMachineId: input.access.serverMachineId,
      sectionId: input.access.movieSectionId,
      sectionType: "movie",
    },
  });
  if (binding.status !== "current")
    return { queued: 0, guards: [work.freshness] };
  if (identityHash(binding.association.group) !== identityHash(proof.group))
    throw new Error(
      "Movie replacement readiness lost its original serving owner",
    );
  const notices = await queueMovieNoticesV4(
    tx,
    {
      access: input.access,
      draft: {
        schemaVersion: 4,
        kind: "movie_subtitle_replacement",
        eventKind: "subtitles_ready",
        source,
        captionHash: proof.publicationHash,
        targetAuthority: work.authority,
        recoveryEpoch: input.epoch,
        asset: {
          id: proof.group.assetId,
          version: proof.group.assetVersion,
          checksum: proof.group.checksum,
        },
      },
    },
    budget,
  );
  work.freshness.assertActive();
  return {
    queued: notices.queued,
    guards: [...notices.guards, work.freshness],
  };
}
