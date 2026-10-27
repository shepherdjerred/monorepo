import path from "node:path";
import { z } from "zod";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import {
  MovieFilePlanSchema,
  MovieBirthAuthoritySchema,
} from "#shared/movie-editions/management/contracts.ts";
import { movieEditionDefinition } from "#shared/movie-editions/registry.ts";
import { fileIdentityEvidence } from "#automation/files/acquisition-identity/evidence.ts";
import { inspectMedia } from "#filesystem/media-tools.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import {
  safeDownloadPath,
  probeAttributes,
} from "#automation/files/inspection.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { movieEditionLibraryPath } from "#automation/files/editions/movie-path.ts";
import { stageEmbedded } from "#automation/files/embedded.ts";
import { captureEmbeddedStreamFacts } from "#automation/files/subtitle-lifecycle/embedded-facts.ts";
import { ownedSubtitleSidecars } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { assertMovieCutV2 } from "#infrastructure/movie-editions/cut-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { collectResolvedEvidence } from "#migration/runtime-evidence.ts";
import { prepareResolvedMovieEvidenceV4 } from "#migration/movie-evidence/prepare.ts";
import { measureQuality } from "#automation/files/resolved-measurement.ts";
import type { MovieFileAuthorityV4 } from "./authority.ts";
import { assertMovieMeasuredUpgradeV4 } from "./authority.ts";

/** Probe/hash/regex work runs outside final PG locks; the caller rechecks this complete plan before staging. */
export async function prepareMovieFilePlanV4(
  context: PublicationContext,
  input: MovieAttemptOperationV4,
  authority: MovieFileAuthorityV4,
  beforeEmbedded: () => Promise<void>,
) {
  const videos = authority.observation.files.filter(
    (file) =>
      /\.(?:mkv|mp4|m4v|avi)$/iu.test(file.name) &&
      !/(?:^|[/._ -])(?:sample|extras|featurettes|trailer)(?:[/._ -]|$)/iu.test(
        file.name,
      ),
  );
  const member = videos[0];
  if (videos.length !== 1 || member?.progress !== 1)
    throw new FileGuardError("movie_files_ambiguous");
  const identityEvidence = fileIdentityEvidence(authority.identity, member);
  const cut = await assertMovieCutV2(context.db, {
    scope: input.scope,
    releaseId: authority.attempt.releaseId,
    predecessorAssetIds: [],
    phase: "physical",
    members: [
      {
        attemptId: input.attemptId,
        torrentFileIndex: member.index,
        relativePath: member.name,
        sizeBytes: String(member.size),
      },
    ],
  });
  const memberCut = cut.members[0];
  if (memberCut === undefined)
    throw new Error(
      "Movie physical cut assessment omitted its selected member",
    );
  const source = await safeDownloadPath(
    context.roots.movies.downloads,
    workerFilePath(context, authority.observation.torrent.save_path),
    member.name,
  );
  await context.checkpoint("inspecting");
  const probe = await (context.inspect ?? inspectMedia)(source.absolute);
  if (Number(probe.format.size) !== member.size)
    throw new FileGuardError("file_size_changed");
  const measured = {
    ...authority.assessment.attributes,
    id: authority.release.id,
    providerId: authority.release.providerId,
    title: authority.release.title,
    ...probeAttributes(probe, authority.assessment.attributes.quality),
    mediaIds: [input.scope.mediaId],
    sizeBytes: member.size,
  };
  const profile = authority.profile.resolved;
  if (profile !== undefined) {
    const prepared = prepareResolvedMovieEvidenceV4(
      profile,
      {
        id: measured.id,
        title: measured.title,
        filename: path.basename(member.name),
        identityConfirmed: measured.identityConfidence === "exact",
        sizeBytes: member.size,
        runtimeMinutes: authority.policyMetadata.runtimeMinutes,
        originalLanguage: authority.policyMetadata.originalLanguage,
        audioLanguages:
          measured.audioLanguages.length === 0 ? null : measured.audioLanguages,
        specialEpisode: false,
      },
      cut.candidate,
    );
    measureQuality(profile, prepared, measured.quality);
    measured.resolvedEvidence = await collectResolvedEvidence(
      profile,
      prepared,
    );
  }
  const previous = await assertMovieMeasuredUpgradeV4(
    context.db,
    authority,
    measured,
  );
  const checksum = await sha256File(source.absolute, async () => {
    await context.checkpoint("hashing");
  });
  const media = await context.db.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
    include: { parent: { include: { parent: true } } },
  });
  const libraryPath =
    previous === null
      ? movieEditionLibraryPath(
          media,
          member.name,
          movieEditionDefinition(input.scope.rootMediaId, input.scope.edition),
        )
      : path.relative(
          context.roots.movies.library,
          workerFilePath(context, previous.path),
        );
  const previousSidecars = (
    previous === null ? [] : ownedSubtitleSidecars(previous)
  ).map((subtitle) => {
    if (subtitle.path === null)
      throw new FileGuardError("subtitle_path_missing");
    return {
      subtitleId: subtitle.id,
      libraryPath: path.relative(
        context.roots.movies.library,
        workerFilePath(context, subtitle.path),
      ),
      checksum: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .parse(subtitle.checksum),
      quarantineId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
    };
  });
  const assetId = crypto.randomUUID();
  await beforeEmbedded();
  const embedded = await stageEmbedded({
    context,
    kind: "movies",
    source: source.absolute,
    probe,
    mediaIds: [input.scope.mediaId],
    assetId,
    movieScope: input.scope,
  });
  authority.freshness.assertActive();
  context.execution.assertActive();
  return MovieFilePlanSchema.parse({
    schemaVersion: authority.identity.schemaVersion === 2 ? 2 : 3,
    attemptId: input.attemptId,
    scope: input.scope,
    birth: MovieBirthAuthoritySchema.parse(
      authority.attempt.movieEditionAuthority,
    ),
    entries: [
      {
        identityEvidence,
        editionEvidence: { candidate: cut.candidate, member: memberCut },
        assetId,
        mediaIds: [input.scope.mediaId],
        generations: authority.attempt.generations,
        libraryKind: "movies",
        downloadPath: source.relative,
        libraryPath,
        checksum,
        sizeBytes: String(member.size),
        operationId: crypto.randomUUID(),
        previousAssetId: previous?.id ?? null,
        previousChecksum: previous?.checksum ?? null,
        previousVersion: previous?.version ?? null,
        previousSidecars,
        embeddedSubtitles: embedded.subtitles,
        properties: z.json().parse({
          ...measured,
          sourceQuality: authority.assessment.attributes.quality,
          releaseId: authority.release.id,
          movieAssessment: authority.identity.assessment,
          movieScope: input.scope,
          canonicalPolicyHash: identityHash(authority.policyMetadata),
          profileVersions: {
            [input.scope.mediaId]: authority.profile.version,
          },
          embeddedRejectedStreams: embedded.rejectedStreams,
          embeddedStreamFactsV2: captureEmbeddedStreamFacts({
            assetId,
            checksum,
            probe,
            subtitles: embedded.subtitles,
          }),
        }),
      },
    ],
  });
}
