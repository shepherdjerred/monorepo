import { heartbeat, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";
import { watchExecution } from "./media/watch-execution.ts";
import { archiveExecution } from "./media/archive-execution.ts";
import { compensationExecution } from "./media/compensation-execution.ts";
import {
  createPlexBindingNetworkActivities,
  createLibraryPlexBindingNetworkActivities,
} from "./media/plex-binding.ts";
import { plexBindingExecution } from "./media/plex-binding-execution.ts";
import { createPlexPublicationActivities } from "./media/plex-publication.ts";
import { createPlexWatchActivities } from "./media/plex-watch.ts";
import { mediaCall } from "./media/call.ts";
import { createPlexBoundConsumerActivities } from "./media/plex-consumers.ts";
import { createPlexCleanupActivities } from "./media/plex-cleanup.ts";
import { createNativePlexReviewActivities } from "./media/native-plex.ts";
import {
  createLibraryHandoffFileActivities,
  createLibraryHandoffNetworkActivities,
} from "./media/library-handoff.ts";
import type {
  PlexBindingActivities,
  LibraryPlexBindingActivities,
} from "@shepherdjerred/media/plex-binding";
import type {
  SubtitleReplacementFileActivities,
  SubtitleReplacementNetworkActivities,
} from "@shepherdjerred/media/subtitle-replacement";
import type {
  MediaNetworkActivities,
  MediaFileActivities,
  MediaHandoffNetworkActivities,
  MediaHandoffFileActivities,
  LibraryHandoffNetworkActivities,
  LibraryHandoffFileActivities,
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
  LibraryPlexBindingActivities &
  LibraryHandoffNetworkActivities &
  MediaHandoffNetworkActivities &
  SubtitleReplacementNetworkActivities &
  NativeRecoveryNetworkActivities &
  NativeQuarantineNetworkActivities;
type CoreNetworkActivities = Omit<
  NetworkActivities,
  | keyof PlexBindingActivities
  | keyof LibraryPlexBindingActivities
  | keyof LibraryHandoffNetworkActivities
  | "publishMediaToPlex"
  | "publishRolledBackMedia"
  | "publishRestoredMedia"
  | "evaluateMediaRetention"
  | "sweepMediaWork"
  | "finalizeMediaAcquisition"
  | "deliverMediaNotification"
  | "observeMediaUpgradeCleanup"
  | "observeNativeRecovery"
  | "observeNativeQuarantine"
>;
type FileActivities = MediaFileActivities &
  LibraryHandoffFileActivities &
  MediaHandoffFileActivities &
  SubtitleReplacementFileActivities &
  NativeRecoveryFileActivities &
  NativeQuarantineFileActivities;
type CoreFileActivities = Omit<
  FileActivities,
  keyof LibraryHandoffFileActivities
>;
export async function getMediaNetworkRuntime() {
  networkRuntime ??= createMediaNetworkRuntime(
    Bun.env,
    watchExecution,
    archiveExecution,
    { compensation: compensationExecution, plexBinding: plexBindingExecution },
  );
  try {
    const runtime = await networkRuntime;
    return runtime;
  } catch (error) {
    networkRuntime = undefined;
    throw error;
  }
}
export async function getMediaFileRuntime() {
  fileRuntime ??= createMediaFileRuntime(
    Bun.env,
    (phase) => {
      assertNotCancelled();
      heartbeat({ phase });
      return Promise.resolve();
    },
    archiveExecution,
    compensationExecution,
  );
  try {
    const runtime = await fileRuntime;
    return runtime;
  } catch (error) {
    fileRuntime = undefined;
    throw error;
  }
}

async function network(): Promise<CoreNetworkActivities> {
  const runtime = await getMediaNetworkRuntime();
  return runtime.activities;
}

async function files(): Promise<CoreFileActivities> {
  const runtime = await getMediaFileRuntime();
  return runtime.activities;
}

/** Do not serialize Prisma queries, provider URLs, or credentials into Workflow history. */
async function withNetwork<T>(
  work: (activities: CoreNetworkActivities) => Promise<T>,
): Promise<T> {
  return mediaCall(async () => work(await network()));
}
async function withFiles<T>(
  work: (activities: CoreFileActivities) => Promise<T>,
): Promise<T> {
  return mediaCall(async () => work(await files()));
}

function assertNotCancelled(): void {
  if (Context.current().cancellationSignal.aborted)
    throw new CancelledFailure("Media Activity cancelled");
}

export const mediaNetworkWorkerActivities: NetworkActivities = {
  ...createLibraryPlexBindingNetworkActivities(getMediaNetworkRuntime),
  ...createLibraryHandoffNetworkActivities(getMediaNetworkRuntime),
  observeMediaUpgradeCleanup: createPlexCleanupActivities(
    getMediaNetworkRuntime,
  ).observeMediaUpgradeCleanup,
  reverifyPlexBinding: createPlexBindingNetworkActivities(
    getMediaNetworkRuntime,
  ).reverifyPlexBinding,
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
    createNativePlexReviewActivities(
      getMediaNetworkRuntime,
    ).observeNativeRecovery(input),
  observeNativeQuarantine: (input) =>
    createNativePlexReviewActivities(
      getMediaNetworkRuntime,
    ).observeNativeQuarantine(input),
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
    createPlexWatchActivities(getMediaNetworkRuntime).sweepMediaWork(input),
  reconcileMediaIntent: (input) =>
    withNetwork((activities) => activities.reconcileMediaIntent(input)),
  submitMediaTorrent: (input) =>
    withNetwork((activities) => activities.submitMediaTorrent(input)),
  observeMediaAcquisition: (input) =>
    withNetwork((activities) => activities.observeMediaAcquisition(input)),
  publishMediaToPlex: (input) =>
    createPlexPublicationActivities(getMediaNetworkRuntime).publishMediaToPlex(
      input,
    ),
  publishRolledBackMedia: (input) =>
    createPlexPublicationActivities(
      getMediaNetworkRuntime,
    ).publishRolledBackMedia(input),
  publishRestoredMedia: (input) =>
    createPlexPublicationActivities(
      getMediaNetworkRuntime,
    ).publishRestoredMedia(input),
  finalizeMediaAcquisition: (input) =>
    createPlexBoundConsumerActivities(
      getMediaNetworkRuntime,
    ).finalizeMediaAcquisition(input),
  findMediaSubtitles: (input) =>
    withNetwork((activities) => activities.findMediaSubtitles(input)),
  evaluateMediaSeeding: (input) =>
    withNetwork((activities) => activities.evaluateMediaSeeding(input)),
  removeMediaTorrent: (input) =>
    withNetwork((activities) => activities.removeMediaTorrent(input)),
  evaluateMediaRetention: (input) =>
    createPlexWatchActivities(getMediaNetworkRuntime).evaluateMediaRetention(
      input,
    ),
  deliverMediaNotification: (input) =>
    createPlexBoundConsumerActivities(
      getMediaNetworkRuntime,
    ).deliverMediaNotification(input),
  finishMediaOperation: (input) =>
    withNetwork((activities) => activities.finishMediaOperation(input)),
};
export const mediaFileWorkerActivities: FileActivities = {
  ...createLibraryHandoffFileActivities(getMediaFileRuntime),
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
