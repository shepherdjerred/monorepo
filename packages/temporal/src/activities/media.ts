import { ApplicationFailure, heartbeat, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";
import type {
  MediaNetworkActivities,
  MediaFileActivities,
} from "@shepherdjerred/media/automation";
import {
  createMediaNetworkRuntime,
  createMediaFileRuntime,
} from "@shepherdjerred/media/automation/network";

let networkRuntime: ReturnType<typeof createMediaNetworkRuntime> | undefined;
let fileRuntime: ReturnType<typeof createMediaFileRuntime> | undefined;
async function network(): Promise<MediaNetworkActivities> {
  networkRuntime ??= createMediaNetworkRuntime(Bun.env);
  try {
    const runtime = await networkRuntime;
    return runtime.activities;
  } catch (error) {
    networkRuntime = undefined;
    throw error;
  }
}
async function files(): Promise<MediaFileActivities> {
  fileRuntime ??= createMediaFileRuntime(Bun.env, (phase) => {
    assertNotCancelled();
    heartbeat({ phase });
    return Promise.resolve();
  });
  try {
    const runtime = await fileRuntime;
    return runtime.activities;
  } catch (error) {
    fileRuntime = undefined;
    throw error;
  }
}

/** Do not serialize Prisma queries, provider URLs, or credentials into Workflow history. */
async function withNetwork<T>(
  work: (activities: MediaNetworkActivities) => Promise<T>,
): Promise<T> {
  try {
    assertNotCancelled();
    const result = await work(await network());
    assertNotCancelled();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    throw ApplicationFailure.create({
      message: "Media Activity failed; inspect sanitized operation status",
      type: "MediaActivityFailure",
    });
  }
}
async function withFiles<T>(
  work: (activities: MediaFileActivities) => Promise<T>,
): Promise<T> {
  try {
    assertNotCancelled();
    const result = await work(await files());
    assertNotCancelled();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    throw ApplicationFailure.create({
      message: "Media Activity failed; inspect sanitized operation status",
      type: "MediaActivityFailure",
    });
  }
}

function assertNotCancelled(): void {
  if (Context.current().cancellationSignal.aborted)
    throw new CancelledFailure("Media Activity cancelled");
}

export const mediaNetworkWorkerActivities: MediaNetworkActivities = {
  refreshMediaCatalog: (input) =>
    withNetwork((activities) => activities.refreshMediaCatalog(input)),
  expandCatalogRequests: (input) =>
    withNetwork((activities) => activities.expandCatalogRequests(input)),
  expandMediaRequest: (input) =>
    withNetwork((activities) => activities.expandMediaRequest(input)),
  dispatchMediaOutbox: () =>
    withNetwork((activities) => activities.dispatchMediaOutbox()),
  sweepMediaWork: (input) =>
    withNetwork((activities) => activities.sweepMediaWork(input)),
  reconcileMediaIntent: (input) =>
    withNetwork((activities) => activities.reconcileMediaIntent(input)),
  submitMediaTorrent: (input) =>
    withNetwork((activities) => activities.submitMediaTorrent(input)),
  observeMediaAcquisition: (input) =>
    withNetwork((activities) => activities.observeMediaAcquisition(input)),
  publishMediaToPlex: (input) =>
    withNetwork((activities) => activities.publishMediaToPlex(input)),
  publishRolledBackMedia: (input) =>
    withNetwork((activities) => activities.publishRolledBackMedia(input)),
  publishRestoredMedia: (input) =>
    withNetwork((activities) => activities.publishRestoredMedia(input)),
  finalizeMediaAcquisition: (input) =>
    withNetwork((activities) => activities.finalizeMediaAcquisition(input)),
  findMediaSubtitles: (input) =>
    withNetwork((activities) => activities.findMediaSubtitles(input)),
  evaluateMediaSeeding: (input) =>
    withNetwork((activities) => activities.evaluateMediaSeeding(input)),
  removeMediaTorrent: (input) =>
    withNetwork((activities) => activities.removeMediaTorrent(input)),
  evaluateMediaRetention: (input) =>
    withNetwork((activities) => activities.evaluateMediaRetention(input)),
  deliverMediaNotification: (input) =>
    withNetwork((activities) => activities.deliverMediaNotification(input)),
  finishMediaOperation: (input) =>
    withNetwork((activities) => activities.finishMediaOperation(input)),
};
export const mediaFileWorkerActivities: MediaFileActivities = {
  cleanupSupersededMediaFile: (input) =>
    withFiles((activities) => activities.cleanupSupersededMediaFile(input)),
  inspectAndStageMedia: (input) =>
    withFiles((activities) => activities.inspectAndStageMedia(input)),
  promoteMediaFiles: (input) =>
    withFiles((activities) => activities.promoteMediaFiles(input)),
  rollbackMediaPromotion: (input) =>
    withFiles((activities) => activities.rollbackMediaPromotion(input)),
  quarantineMediaFiles: (input) =>
    withFiles((activities) => activities.quarantineMediaFiles(input)),
  restoreMediaFiles: (input) =>
    withFiles((activities) => activities.restoreMediaFiles(input)),
  purgeMediaFiles: (input) =>
    withFiles((activities) => activities.purgeMediaFiles(input)),
  installMediaSubtitles: (input) =>
    withFiles((activities) => activities.installMediaSubtitles(input)),
};

export async function closeMediaActivityRuntimes(): Promise<void> {
  if (networkRuntime !== undefined) {
    const runtime = await networkRuntime;
    await runtime.close();
  }
  if (fileRuntime !== undefined) {
    const runtime = await fileRuntime;
    await runtime.close();
  }
}
