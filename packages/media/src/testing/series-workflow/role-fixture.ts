import { rm } from "node:fs/promises";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedSeriesFixture } from "./fixture.ts";
import { extendManagedSeriesBatch } from "./cross-batch-fixture.ts";
import {
  createAcquisitionNetworkFacet,
  createAcquisitionFileFacet,
} from "#automation/acquisition-management/facets.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";

export async function createManagedSeriesWorkflowFixture(
  options: { crossBatch?: "series" | "episodes" } = {},
) {
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
      {
        original,
        upgrade,
        ...(options.crossBatch === "series"
          ? { monitorSeries: { includeSpecials: false } }
          : {}),
      },
    );
    const second =
      options.crossBatch === undefined
        ? null
        : await extendManagedSeriesBatch(f, upgrade);
    const context = second === null ? f.context : second.context;
    const ids = second === null ? f.ids : second.ids;
    const wire = second === null ? f.wire : second.wire;
    const originalAssetIds = [
      f.asset.id,
      ...(second === null ? [] : [second.asset.id]),
    ];
    const selected = { mediaId: { in: ids }, edition: "default" };
    return {
      mediaIds: ids,
      receiptId: f.receiptId,
      originalAssetIds,
      expectedManagement:
        second === null
          ? { schemaVersion: 1, receiptId: f.receiptId }
          : options.crossBatch === "series"
            ? { schemaVersion: 2, receiptId: f.receiptId }
            : {
                schemaVersion: 3,
                approvals: [f.receiptId, second.receiptId]
                  .sort()
                  .map((receiptId) => ({ receiptId })),
              },
      acquisition: createAcquisitionNetworkFacet(context),
      fileAcquisition: createAcquisitionFileFacet(f.files),
      ...createPlexRuntimeFacets(context, () => Promise.resolve(false)),
      finishMediaOperation: createOutboxActivities(db, () =>
        Promise.reject(new Error("Completion cannot dispatch")),
      ).finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(db, start).dispatchMediaOutbox(),
      evidence: async () => ({
        operations: await db.operation.findMany({
          where: { kind: "reconcile_media", targetId: { in: f.ids } },
          include: { outbox: true },
          orderBy: { createdAt: "asc" },
        }),
        attempts: await db.acquisitionAttempt.findMany({
          where: { mediaIds: { hasSome: ids } },
          include: { reservations: true, torrent: true },
        }),
        assets: await db.libraryAsset.findMany({
          where: { coverage: { some: selected } },
          include: { coverage: true },
        }),
        bindings: await db.plexBindingCurrent.findMany({
          where: selected,
          orderBy: { mediaId: "asc" },
        }),
        personalRequests: await db.mediaRequest.count({
          where: { mediaId: { in: [f.series.id, ...ids] } },
        }),
        adds: wire.additions(),
      }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
