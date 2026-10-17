import { ApplicationFailure, heartbeat, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";
import type {
  SubtitleReplacementFileActivities,
  SubtitleReplacementNetworkActivities,
} from "@shepherdjerred/media/subtitle-replacement";
import type {
  MediaNetworkActivities,
  MediaFileActivities,
  MediaHandoffNetworkActivities,
  MediaHandoffFileActivities,
  NativeRecoveryNetworkActivities,
  NativeRecoveryFileActivities,
  NativeQuarantineNetworkActivities,
  NativeQuarantineFileActivities,
} from "@shepherdjerred/media/automation";
import {
  createMediaNetworkRuntime,
  createMediaFileRuntime,
} from "@shepherdjerred/media/automation/network";

let networkRuntime: ReturnType<typeof createMediaNetworkRuntime> | undefined;
let fileRuntime: ReturnType<typeof createMediaFileRuntime> | undefined;
type NetworkActivities = MediaNetworkActivities &
  MediaHandoffNetworkActivities &
  SubtitleReplacementNetworkActivities &
  NativeRecoveryNetworkActivities &
  NativeQuarantineNetworkActivities;
type FileActivities = MediaFileActivities &
  MediaHandoffFileActivities &
  SubtitleReplacementFileActivities &
  NativeRecoveryFileActivities &
  NativeQuarantineFileActivities;
export async function getMediaNetworkRuntime() {
  networkRuntime ??= createMediaNetworkRuntime(Bun.env);
  try {
    const runtime = await networkRuntime;
    return runtime;
  } catch (error) {
    networkRuntime = undefined;
    throw error;
  }
}
export async function getMediaFileRuntime() {
  fileRuntime ??= createMediaFileRuntime(Bun.env, (phase) => {
    assertNotCancelled();
    heartbeat({ phase });
    return Promise.resolve();
  });
  try {
    const runtime = await fileRuntime;
    return runtime;
  } catch (error) {
    fileRuntime = undefined;
    throw error;
  }
}

async function network(): Promise<NetworkActivities> {
  const runtime = await getMediaNetworkRuntime();
  return runtime.activities;
}

async function files(): Promise<FileActivities> {
  const runtime = await getMediaFileRuntime();
  return runtime.activities;
}

/** Do not serialize Prisma queries, provider URLs, or credentials into Workflow history. */
async function withNetwork<T>(
  work: (activities: NetworkActivities) => Promise<T>,
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
  work: (activities: FileActivities) => Promise<T>,
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

export const mediaNetworkWorkerActivities: NetworkActivities = {
  beginSubtitleReplacementReconciliation: (input) =>
    withNetwork((activities) =>
      activities.beginSubtitleReplacementReconciliation(input),
    ),
  subtitleReplacementState: (input) =>
    withNetwork((activities) => activities.subtitleReplacementState(input)),
  queueSubtitleReplacementCleanup: (input) =>
    withNetwork((activities) =>
      activities.queueSubtitleReplacementCleanup(input),
    ),
  observeNativeRecovery: (input) =>
    withNetwork((activities) => activities.observeNativeRecovery(input)),
  observeNativeQuarantine: (input) =>
    withNetwork((activities) => activities.observeNativeQuarantine(input)),
  nativeRecoveryState: (input) =>
    withNetwork((activities) => activities.nativeRecoveryState(input)),
  observeMediaHandoff: (input) =>
    withNetwork((activities) => activities.observeMediaHandoff(input)),
  mediaHandoffState: (input) =>
    withNetwork((activities) => activities.mediaHandoffState(input)),
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
export const mediaFileWorkerActivities: FileActivities = {
  prepareSubtitleReplacement: (input) =>
    withFiles((activities) => activities.prepareSubtitleReplacement(input)),
  applySubtitleReplacement: (input) =>
    withFiles((activities) => activities.applySubtitleReplacement(input)),
  reconcileSubtitleReplacement: (input) =>
    withFiles((activities) => activities.reconcileSubtitleReplacement(input)),
  cleanupSubtitleReplacement: (input) =>
    withFiles((activities) => activities.cleanupSubtitleReplacement(input)),
  prepareNativeRecoveryFiles: (input) =>
    withFiles((activities) => activities.prepareNativeRecoveryFiles(input)),
  applyNativeRecoveryFiles: (input) =>
    withFiles((activities) => activities.applyNativeRecoveryFiles(input)),
  prepareNativeQuarantineFiles: (input) =>
    withFiles((activities) => activities.prepareNativeQuarantineFiles(input)),
  applyNativeQuarantineFiles: (input) =>
    withFiles((activities) => activities.applyNativeQuarantineFiles(input)),
  restoreNativeQuarantineFiles: (input) =>
    withFiles((activities) => activities.restoreNativeQuarantineFiles(input)),
  prepareMediaHandoffFiles: (input) =>
    withFiles((activities) => activities.prepareMediaHandoffFiles(input)),
  applyMediaHandoffFiles: (input) =>
    withFiles((activities) => activities.applyMediaHandoffFiles(input)),
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
