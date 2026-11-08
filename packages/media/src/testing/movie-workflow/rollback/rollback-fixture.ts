import { z } from "zod";
import { expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createAcquiredMovieUpgradeFixture } from "#testing/movie-workflow/upgrade-fixture.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { MoviePublicationIntentV2Schema } from "#shared/movie-editions/publication-v2.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { PlexClient } from "#integrations/plex.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";

export const movieRollbackEditions = MovieEditionKeySchema.options;
export async function movieRollbackVideos() {
  return {
    original: await movieVideoFixture(),
    upgrade: await movieVideoFixture(3840),
  };
}

/** Real served A + two captions, then genuine B Files publication. Only the
 * remote Plex inventory is rejected; no attempt/asset state is fabricated. */
export async function createMovieRollbackFixture(
  edition: MovieEditionKey,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const f = await createAcquiredMovieUpgradeFixture(edition, bytes);
  try {
    const db = f.context.db;
    const acquired = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(acquired.status).toBe("acquire");
    const input = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      attemptId: z.uuid().parse(acquired.attemptId),
      scope: f.scope,
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
      await f.fileMovie.prepareMoviePublicationV4(
        input,
        testPublicationExecution(),
        new PublicationAuthorityReadBudget(),
      ),
    ).toEqual({ status: "prepared" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    const source = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    const plan = MovieFilePlanSchema.parse(source.filePlan);
    const rejectedPlex = new PlexClient(
      {
        baseUrl: "http://rollback-plex.fixture",
        token: "synthetic",
        clientIdentifier: "synthetic-rollback",
      },
      (url) => {
        if (url.pathname === "/identity")
          return Promise.resolve(
            Response.json({
              MediaContainer: { machineIdentifier: "fixture-server" },
            }),
          );
        if (url.pathname === "/library/sections")
          return Promise.resolve(
            Response.json({
              MediaContainer: {
                size: 1,
                Directory: [{ key: "1", type: "movie", title: "Movies" }],
              },
            }),
          );
        if (url.pathname === "/library/sections/1/refresh")
          return Promise.resolve(new Response(null, { status: 200 }));
        if (url.pathname === "/library/sections/1/all")
          return Promise.resolve(
            Response.json({
              MediaContainer: { size: 0, totalSize: 0, Metadata: [] },
            }),
          );
        throw new Error(
          `Unexpected rejected Plex fixture route: ${url.pathname}`,
        );
      },
    );
    const rejectedMovie = createMovieNetworkFacetV4({
      ...f.context,
      plex: rejectedPlex,
    });
    const immutable = async () => ({
      attempts: await db.acquisitionAttempt.findMany({
        where: { mediaIds: { has: f.scope.mediaId } },
        orderBy: { id: "asc" },
      }),
      transitions: await db.mediaPublicationTransition.findMany({
        where: { intent: { path: ["scope"], equals: f.scope } },
        orderBy: { id: "asc" },
      }),
      originalServing: await db.operation.findMany({
        where: {
          targetId: f.scope.mediaId,
          OR: [
            "moviePlexReceiptV2",
            "moviePlexReceiptV3",
            "movieRestorePlexReceiptV1",
          ].map((key) => ({
            result: {
              path: [key, "receipt", "input", "scope"],
              equals: f.scope,
            },
          })),
        },
        orderBy: { id: "asc" },
      }),
    });
    const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: input.attemptId },
    });
    const intent = MoviePublicationIntentV2Schema.parse(transition.intent);
    const baseline = intent.entries[0].predecessor;
    if (baseline === null)
      throw new Error("Actual movie upgrade lost its served predecessor");
    const state = async () => {
      const predecessor = await db.libraryAsset.findUniqueOrThrow({
        where: { id: f.asset.id },
        include: { subtitles: { orderBy: { id: "asc" } } },
      });
      const successor = await db.libraryAsset.findUniqueOrThrow({
        where: { id: plan.entries[0].assetId },
        include: { subtitles: { orderBy: { id: "asc" } } },
      });
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      const pointer = await db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      });
      const assets = [predecessor, successor];
      const files = assets.flatMap((asset) => [
        asset.path,
        ...asset.subtitles
          .filter(
            (caption) =>
              caption.storageKind === "sidecar" &&
              ["installed", "superseded"].includes(caption.state),
          )
          .map((caption) => z.string().parse(caption.path)),
      ]);
      return {
        predecessor,
        successor,
        operation,
        pointer,
        bytes: await Promise.all(
          files.map((name) => readFile(workerFilePath(f.files, name))),
        ),
        torrents: await db.torrent.findMany({ orderBy: { id: "asc" } }),
      };
    };
    return { ...f, db, input, plan, baseline, rejectedMovie, immutable, state };
  } catch (error) {
    await f.close();
    throw error;
  }
}
