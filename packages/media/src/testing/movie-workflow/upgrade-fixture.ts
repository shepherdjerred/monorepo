import { z } from "zod";
import { expect } from "vitest";
import { createMovieWorkflowFixture } from "./fixture.ts";
import { movieWorkflowWire } from "./wire.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import type { Database } from "#infrastructure/database.ts";

/** Both versions start at actual personal consent; no imported request-history hold is removed. */
export async function createAcquiredMovieUpgradeFixture(
  edition: MovieEditionKey,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const f = await createMovieWorkflowFixture(edition, {
    bytes: bytes.original,
  });
  try {
    const { db, files, context, media, user } = f.source;
    const reserved = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(reserved.status).toBe("acquire");
    const input = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      scope: f.input.scope,
      attemptId: z.uuid().parse(reserved.attemptId),
    };
    expect(
      await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await f.movie.observeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    expect(
      await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    const initial = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    const plan = MovieFilePlanSchema.parse(initial.filePlan);
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: plan.entries[0].assetId },
    });
    await installMovieFixtureCaptions(db, asset.id, f.movie, f.fileMovie);
    const request = await requestTestMovieV4(db, user, media.id, edition);
    const wire = movieWorkflowWire(db, {
      mediaId: media.id,
      edition,
      title: media.title,
      year: z.number().parse(media.year),
      downloads: files.roots.movies.downloads,
      bytes: bytes.upgrade,
      resolution: 2160,
      providerReleaseId: `synthetic-upgrade:${media.id}:${edition}`,
    });
    const network = { ...context, ...wire };
    return {
      input: request.input,
      scope: request.input.scope,
      asset,
      target: workerFilePath(files.context, asset.path),
      context: network,
      files: files.context,
      network: { actor: user },
      wire,
      movie: createMovieNetworkFacetV4(network),
      fileMovie: createMovieFileFacetV4(files.context),
      close: f.close,
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

/** Real embedded-source selection and installation receipts, before the next video lifecycle. */
export async function installMovieFixtureCaptions(
  db: Database,
  assetId: string,
  movie: ReturnType<typeof createMovieNetworkFacetV4>,
  files: ReturnType<typeof createMovieFileFacetV4>,
) {
  const commands = await db.operation.findMany({
    where: {
      kind: "acquire_movie_subtitles_v4",
      payload: { path: ["assetId"], equals: assetId },
    },
  });
  expect(commands).toHaveLength(2);
  for (const command of commands) {
    const input = MovieSubtitleOperationV4Schema.parse(
      z.object(MovieSubtitleOperationV4Schema.shape).parse(command.payload),
    );
    const selected = await movie.findMovieSubtitlesV4(
      input,
      testPlexBindingExecution(),
    );
    expect(selected.status).toBe("found");
    expect(
      await files.installMovieSubtitlesV4(
        {
          schemaVersion: 4,
          operationId: command.id,
          scope: input.scope,
          assetId,
          subtitleId: z.uuid().parse(selected.subtitleId),
        },
        testPublicationExecution(),
      ),
    ).toEqual({ status: "installed" });
  }
}
