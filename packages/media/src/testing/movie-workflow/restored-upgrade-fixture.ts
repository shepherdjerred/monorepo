import { z } from "zod";
import { readFile } from "node:fs/promises";
import { expect } from "vitest";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { createRestoredMovieFixture } from "./restore-fixture.ts";
import { movieWorkflowWire } from "./wire.ts";
import { publishRestoredMovieToPlexV4 } from "#automation/movie-editions/retention/restore-plex.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { MovieRestorePlexReceiptEnvelopeV1Schema } from "#shared/movie-editions/restore-plex-v1.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";

/** Genuine restored serving bytes and a new requester-owned higher-quality acquisition, without synthetic ancestry. */
export async function createRestoredMovieUpgradeFixture(
  edition: MovieEditionKey,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const f = await createRestoredMovieFixture(edition, bytes.original);
  try {
    expect(
      await publishRestoredMovieToPlexV4(
        f.context,
        f.input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "available", reason: null });
    const restored = await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } } },
    });
    const restoredCaptions = await Promise.all(
      restored.subtitles
        .filter(
          (row) => row.state === "installed" && row.storageKind === "sidecar",
        )
        .map(async (row) => {
          if (row.path === null)
            throw new Error(
              "Real restored caption is missing its installed path",
            );
          return {
            id: row.id,
            bytes: await readFile(
              workerFilePath(f.source.files.context, row.path),
            ),
          };
        }),
    );
    const restoreCommand = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    const restoration = MovieRestorePlexReceiptEnvelopeV1Schema.parse(
      z
        .object({ movieRestorePlexReceiptV1: z.unknown() })
        .parse(restoreCommand.result).movieRestorePlexReceiptV1,
    );
    const request = await requestTestMovieV4(
      f.db,
      f.source.user,
      f.scope.mediaId,
      edition,
    );
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: request.input.operationId },
      }),
    ).toMatchObject({ kind: "reconcile_movie_edition_v4" });
    const wire = movieWorkflowWire(f.db, {
      mediaId: f.scope.mediaId,
      edition,
      downloads: f.source.files.roots.movies.downloads,
      bytes: bytes.upgrade,
      title: f.source.media.title,
      year: z.number().parse(f.source.media.year),
      resolution: 2160,
      providerReleaseId: `synthetic-restored-upgrade:${f.scope.mediaId}:${edition}`,
    });
    const context = { ...f.source.context, ...wire };
    return {
      ...f,
      restored,
      restoredCaptions,
      restoration,
      restoreInput: f.input,
      input: request.input,
      wire,
      context,
      movie: createMovieNetworkFacetV4(context),
      fileMovie: createMovieFileFacetV4(f.source.files.context),
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
