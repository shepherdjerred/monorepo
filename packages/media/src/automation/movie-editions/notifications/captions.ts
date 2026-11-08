import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";
import { readMovieCaptionNoticeSource } from "./source.ts";
import { queueMovieNoticesV4 } from "./queue.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";

/** Called at caption installation and serving publication, in the same exact-scope transaction. */
export async function queueReadyMovieCaptionNoticesV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    assetId: string;
    epoch: number;
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const work = await currentMovieSubtitleWorkV4(tx, input, budget);
  if (work.targets.length === 0 || !subtitleTargetsReady(work, input.epoch))
    return { queued: 0, guards: [work.freshness] };
  // Current installed progress can precede serving. Its real immutable receipt remains the source.
  const captions = work.asset.subtitles
    .filter((subtitle) =>
      work.targets.some((target) =>
        subtitleAccepted({
          subtitle,
          asset: work.asset,
          epoch: input.epoch,
          target,
        }),
      ),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const evidence = z.object({
    movieInstallationV4: z.object({
      schemaVersion: z.literal(4),
      operationId: z.uuid(),
    }),
  });
  const selected = captions.find((row) => {
    const header = z
      .object({ movieInstallationV4: z.unknown().optional() })
      .parse(row.matchingEvidence);
    if (header.movieInstallationV4 === undefined) return false;
    evidence.parse(row.matchingEvidence);
    return true;
  });
  if (selected === undefined) return { queued: 0, guards: [work.freshness] };
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
  const parsed = evidence.parse(selected.matchingEvidence);
  const source = {
    schemaVersion: 4 as const,
    scope: input.scope,
    assetId: input.assetId,
    subtitleId: selected.id,
    operationId: parsed.movieInstallationV4.operationId,
  };
  const proof = await readMovieCaptionNoticeSource(tx, source, budget);
  if (identityHash(binding.association.group) !== identityHash(proof.group))
    throw new Error("Movie caption notice lost its original physical owner");
  const notices = await queueMovieNoticesV4(
    tx,
    {
      access: input.access,
      draft: {
        schemaVersion: 4,
        kind: "movie_subtitles",
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
