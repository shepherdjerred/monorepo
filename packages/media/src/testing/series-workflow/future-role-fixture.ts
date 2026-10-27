import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedSeriesFixture } from "./fixture.ts";
import { futureSeriesCatalog } from "./catalog-wire.ts";
import { managedSeriesWire } from "./wire.ts";
import { createCatalogActivities } from "#automation/reconciliation/catalog.ts";
import { createCatalogCoverageFacet } from "#automation/reconciliation/library-series.ts";
import {
  createAcquisitionNetworkFacet,
  createAcquisitionFileFacet,
} from "#automation/acquisition-management/facets.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";

/** Real approval and a recurring catalog command precede discovery of the later episode. */
export async function createFutureSeriesWorkflowFixture() {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  const directories: string[] = [];
  const close = async () => {
    try {
      await cluster.close();
    } finally {
      for (const directory of directories)
        await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    const original = await movieVideoFixture(1280);
    const upgrade = await movieVideoFixture(1920, undefined, {
      bitrateKbps: 160_000,
    });
    const f = await createManagedSeriesFixture(
      db,
      (directory) => directories.push(directory),
      { original, upgrade, monitorSeries: { includeSpecials: false } },
    );
    const wire = futureSeriesCatalog(
      f.series.title,
      z.number().parse(f.series.tmdbId),
    );
    const context = { ...f.context, tmdb: wire.client };
    const episode = () =>
      db.mediaItem.findUniqueOrThrow({
        where: { kind_tmdbId: { kind: "episode", tmdbId: wire.episodeId } },
      });
    const createServing = async () => {
      const leaf = await episode();
      return managedSeriesWire(db, {
        seriesId: f.series.id,
        mediaIds: [leaf.id],
        title: f.series.title,
        downloads: f.files.roots.tv.downloads,
        bytes: upgrade,
        show: f.plexShow,
        episodeSpan: { season: 2, first: 3, last: 3 },
        items: [
          {
            ratingKey: String(wire.episodeId + 1_000_000_000),
            type: "episode",
            title: leaf.title,
            librarySectionID: 2,
            grandparentRatingKey: f.plexShow.ratingKey,
            parentRatingKey: String(wire.seasonId + 1_000_000_000),
            parentIndex: 2,
            index: 3,
            Media: [
              {
                Part: [
                  {
                    id: wire.episodeId,
                    file: "/data/tv/future.mkv",
                    size: upgrade.byteLength,
                  },
                ],
              },
            ],
          },
        ],
      });
    };
    let serving: ReturnType<typeof createServing> | undefined;
    const networkContext = async () => ({
      ...context,
      ...(await (serving ??= createServing())),
    });
    const initial = await db.operation.findFirstOrThrow({
      where: { kind: "refresh_catalog", targetId: f.series.id },
    });
    return {
      rootMediaId: f.series.id,
      receiptId: f.receiptId,
      originalAssetId: f.asset.id,
      privateTitle: f.series.title,
      initialOperationId: initial.id,
      episode,
      refreshMediaCatalog: createCatalogActivities(context).refreshMediaCatalog,
      catalogCoverage: createCatalogCoverageFacet(context),
      loadAcquisition: async () => ({
        acquisition: createAcquisitionNetworkFacet(await networkContext()),
      }),
      loadPublication: async () =>
        createPlexRuntimeFacets(await networkContext(), () =>
          Promise.resolve(false),
        ),
      fileAcquisition: createAcquisitionFileFacet(f.files),
      finishMediaOperation: createOutboxActivities(db, () =>
        Promise.reject(new Error("Completion cannot dispatch")),
      ).finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(db, start).dispatchMediaOutbox(),
      evidence: async () => {
        const leaf = await db.mediaItem.findUnique({
          where: { kind_tmdbId: { kind: "episode", tmdbId: wire.episodeId } },
        });
        const ids = [f.series.id, ...(leaf === null ? [] : [leaf.id])];
        const [operations, attempts, personalRequests, assets] =
          await Promise.all([
            db.operation.findMany({
              where: { targetId: { in: ids } },
              orderBy: { createdAt: "asc" },
            }),
            db.acquisitionAttempt.findMany({
              where: { mediaIds: { hasSome: [...ids, ...f.ids] } },
              include: { torrent: true, reservations: true },
            }),
            db.mediaRequest.count({
              where: {
                media: {
                  OR: [
                    { id: f.series.id },
                    { parentId: f.series.id },
                    { parent: { parentId: f.series.id } },
                  ],
                },
              },
            }),
            db.libraryAsset.findMany({
              where: { editionRootId: f.series.id },
              include: { coverage: true },
            }),
          ]);
        const currentServing = await serving;
        return {
          episode: leaf,
          operations,
          attempts,
          personalRequests,
          assets,
          adds: currentServing === undefined ? 0 : currentServing.additions(),
        };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
