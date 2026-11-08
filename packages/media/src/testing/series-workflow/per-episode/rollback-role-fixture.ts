import { createFixtureLifecycle } from "#testing/fixture-lifecycle.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createPerEpisodeMultiSeasonFixture } from "./fixture.ts";
import {
  createAcquisitionNetworkFacet,
  createAcquisitionFileFacet,
} from "#automation/acquisition-management/facets.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
  type WorkflowStart,
} from "#automation/store.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";

/** Actual two approvals and all24 native episode effects; only external transport/attestations are synthetic. */
export async function createPerEpisodeRollbackRoleFixtureV1() {
  const { db, directories, close } = await createFixtureLifecycle();
  try {
    const original = await movieVideoFixture(1280);
    const upgrade = await movieVideoFixture(1920, undefined, {
      bitrateKbps: 160_000,
    });
    const f = await createPerEpisodeMultiSeasonFixture(
      db,
      (directory) => directories.push(directory),
      { original, upgrade },
    );
    f.wire.control.rejectPublishedPlex = true;
    return {
      mediaIds: f.ids,
      operationId: f.input.operationId,
      originalAssetIds: f.originalAssetIds,
      acquisition: createAcquisitionNetworkFacet(f.context),
      fileAcquisition: createAcquisitionFileFacet(f.files),
      ...createPlexRuntimeFacets(f.context, () => Promise.resolve(false)),
      finishMediaOperation: createOutboxActivities(db, () =>
        Promise.reject(new Error("Completion cannot dispatch")),
      ).finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(db, start).dispatchMediaOutbox(),
      roleCommand: (start: WorkflowStart) =>
        start.input["operationId"] === f.input.operationId,
      diagnostic: async () => ({
        operation: await db.operation.findUniqueOrThrow({
          where: { id: f.input.operationId },
          select: { id: true, kind: true, status: true },
        }),
        attempts: await db.acquisitionAttempt.findMany({
          where: { mediaIds: { hasSome: f.ids } },
          select: { id: true, state: true },
        }),
      }),
      evidence: async () => {
        const current = await db.assetCoverage.findMany({
          where: { mediaId: { in: f.ids }, current: true, edition: "default" },
          include: { asset: true },
          orderBy: { mediaId: "asc" },
        });
        return {
          operation: await db.operation.findUniqueOrThrow({
            where: { id: f.input.operationId },
          }),
          attempts: await db.acquisitionAttempt.findMany({
            where: { mediaIds: { hasSome: f.ids } },
            include: { reservations: true, torrent: true },
          }),
          bindings: await db.plexBindingCurrent.findMany({
            where: { mediaId: { in: f.ids }, edition: "default" },
            include: { evidence: true },
            orderBy: { mediaId: "asc" },
          }),
          transitions: await db.mediaPublicationTransition.findMany({
            where: { attempt: { mediaIds: { hasSome: f.ids } } },
          }),
          current,
          hashes: await Promise.all(
            current.map((row) =>
              sha256File(workerFilePath(f.files, row.asset.path)),
            ),
          ),
          rejected: await db.libraryAsset.findMany({
            where: {
              state: "rejected",
              coverage: { some: { mediaId: { in: f.ids } } },
            },
          }),
          receipts: await db.mediaHandoffReceipt.findMany({
            where: {
              id: { in: f.receipts.map((receipt) => receipt.receiptId) },
            },
            orderBy: { id: "asc" },
          }),
          personalRequests: await db.mediaRequest.count({
            where: { mediaId: { in: [f.series.id, ...f.ids] } },
          }),
          sourceHash: candidateDigest(
            await db.releaseCandidate.findUniqueOrThrow({
              where: { id: f.retainedReleaseId },
            }),
          ),
          adds: f.wire.additions(),
        };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
