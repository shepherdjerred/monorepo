import { z } from "zod";
import { createFixtureLifecycle } from "#testing/fixture-lifecycle.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMultiSeasonSeriesFixture } from "./multi-season-fixture.ts";
import {
  createAcquisitionNetworkFacet,
  createAcquisitionFileFacet,
} from "#automation/acquisition-management/facets.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import { createSeriesPackFeedFacetV1 } from "#automation/feeds/series-pack/facet.ts";
import { retainFeedSourceV1 } from "#automation/feeds/source.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
  type WorkflowStart,
} from "#automation/store.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Genuine two-season imports and current provider observation; only remote HTTP, storage attestations and media services are synthetic. */
export async function createMultiSeasonRoleFixtureV1() {
  const { db, directories, close } = await createFixtureLifecycle();
  try {
    const original = await movieVideoFixture(1280);
    const upgrade = await movieVideoFixture(1920, undefined, {
      bitrateKbps: 160_000,
    });
    const f = await createMultiSeasonSeriesFixture(
      db,
      (directory) => directories.push(directory),
      { original, upgrade },
    );
    const sources = await f.wire.providers.withProvider("knaben", (client) =>
      client.search({ query: f.series.title, kind: "tv" }),
    );
    const source = sources[0];
    if (source === undefined || sources.length !== 1)
      throw new Error("Actual retained pack source missing");
    const observed = await retainFeedSourceV1(db, f.context.cipher, source);
    const feed = await db.operation.findUniqueOrThrow({
      where: {
        idempotencyKey: `match-series-pack-feed-source-v1:${observed.id}`,
      },
    });
    const selected = { mediaId: { in: f.ids }, edition: "default" };
    return {
      mediaIds: f.ids,
      feedOperationId: feed.id,
      originalAssetIds: f.originalAssetIds,
      receipts: [f.receiptId, f.second.receiptId],
      acquisition: createAcquisitionNetworkFacet(f.context),
      fileAcquisition: createAcquisitionFileFacet(f.files),
      seriesPackFeed: {
        matchSeriesPackFeedSource: createSeriesPackFeedFacetV1(f.context),
      },
      ...createPlexRuntimeFacets(f.context, () => Promise.resolve(false)),
      finishMediaOperation: createOutboxActivities(db, () =>
        Promise.reject(new Error("Completion cannot dispatch")),
      ).finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(db, start).dispatchMediaOutbox(),
      roleCommand: async (start: WorkflowStart) => {
        const operationId = z.uuid().parse(start.input["operationId"]);
        if (operationId === feed.id) return "feed" as const;
        const operation = await db.operation.findUniqueOrThrow({
          where: { id: operationId },
        });
        const result = z
          .object({
            seriesPackSelectionV1: z.object({ releaseId: z.uuid() }).optional(),
          })
          .parse(operation.result ?? {});
        return operation.kind === "reconcile_media" &&
          result.seriesPackSelectionV1?.releaseId === f.retainedReleaseId
          ? ("acquire" as const)
          : null;
      },
      evidence: async () => ({
        operations: await db.operation.findMany({
          where: {
            OR: [
              { id: feed.id },
              { kind: "reconcile_media", targetId: { in: f.ids } },
            ],
          },
          orderBy: { createdAt: "asc" },
        }),
        attempts: await db.acquisitionAttempt.findMany({
          where: { mediaIds: { hasSome: f.ids } },
          include: { reservations: true, torrent: true },
        }),
        assets: await db.libraryAsset.findMany({
          where: { coverage: { some: selected } },
          include: { coverage: true },
        }),
        bindings: await db.plexBindingCurrent.findMany({
          where: selected,
          include: { evidence: true },
          orderBy: { mediaId: "asc" },
        }),
        personalRequests: await db.mediaRequest.count({
          where: { mediaId: { in: [f.series.id, ...f.ids] } },
        }),
        sourceHash: candidateDigest(
          await db.releaseCandidate.findUniqueOrThrow({
            where: { id: f.retainedReleaseId },
          }),
        ),
        source: await db.releaseCandidate.findUniqueOrThrow({
          where: { id: f.retainedReleaseId },
          select: { attributes: true, encryptedSource: true },
        }),
        receipts: await db.mediaHandoffReceipt.findMany({
          where: { id: { in: [f.receiptId, f.second.receiptId] } },
          orderBy: { id: "asc" },
        }),
        adds: f.wire.additions(),
      }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
