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
import { createCatalogCoverageWorkerActivities } from "./media/catalog-coverage.ts";
import { createPlexPublicationActivities } from "./media/plex-publication.ts";
import { createPlexWatchActivities } from "./media/plex-watch.ts";
import { createMovieWatchWorkerActivitiesV4 } from "./media/movie-watch.ts";
import { createSeriesPackFeedWorkerActivities } from "./media/series-pack-feed.ts";
import {
  createSeriesPackNativeCompensationFileAdapterV1,
  createSeriesPackNativeCompensationNetworkAdapterV1,
} from "./media/series-pack/native-compensation.ts";
import type {
  SeriesPackNativeFileActivitiesV1,
  SeriesPackNativeNetworkActivitiesV1,
} from "@shepherdjerred/media/native-series-pack-compensation";
import { createSeedingWorkerActivities } from "./media/seeding.ts";
import { createProviderFeedWorkerActivitiesV1 } from "./media/provider-feed.ts";
import { createPlaybackWorkerActivities } from "./media/playback/activities.ts";
import type { PlaybackActivities } from "@shepherdjerred/media/playback";
import {
  createRequestedMovieRollbackFileWorkerActivitiesV1,
  createRequestedMovieRollbackNetworkWorkerActivitiesV1,
} from "./media/movie-editions/manual-rollback.ts";
import type {
  RequestedMovieRollbackFileActivitiesV1,
  RequestedMovieRollbackNetworkActivitiesV1,
} from "@shepherdjerred/media/movie-rollback";
import { mediaCall } from "./media/call.ts";
import { callMovieSubtitleReplacementV2 } from "./media/movie-editions/subtitle-replacement.ts";
import {
  createAcquisitionNetworkWorkerActivities,
  createAcquisitionFileWorkerActivities,
} from "./media/acquisition.ts";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "./media/movie-editions.ts";
import type {
  MovieNetworkActivitiesV4,
  MovieFileActivitiesV4,
  MovieWatchActivitiesV4,
} from "@shepherdjerred/media/movie-lifecycle";
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
  PlaybackActivities &
  SeriesPackNativeNetworkActivitiesV1 &
  RequestedMovieRollbackNetworkActivitiesV1 &
  MovieWatchActivitiesV4 &
  MovieNetworkActivitiesV4 &
  LibraryPlexBindingActivities &
  LibraryHandoffNetworkActivities &
  MediaHandoffNetworkActivities &
  SubtitleReplacementNetworkActivities &
  NativeRecoveryNetworkActivities &
  NativeQuarantineNetworkActivities;
type CoreNetworkActivities = Omit<
  NetworkActivities,
  | keyof SeriesPackNativeNetworkActivitiesV1
  | keyof PlexBindingActivities
  | keyof MovieNetworkActivitiesV4
  | keyof RequestedMovieRollbackNetworkActivitiesV1
  | keyof MovieWatchActivitiesV4
  | keyof PlaybackActivities
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
  | "reconcileMediaIntent"
  | "submitMediaTorrent"
  | "observeMediaAcquisition"
  | "matchSeriesPackFeedSource"
  | "matchProviderFeedSource"
>;
type FileActivities = MediaFileActivities &
  SeriesPackNativeFileActivitiesV1 &
  RequestedMovieRollbackFileActivitiesV1 &
  MovieFileActivitiesV4 &
  LibraryHandoffFileActivities &
  MediaHandoffFileActivities &
  SubtitleReplacementFileActivities &
  NativeRecoveryFileActivities &
  NativeQuarantineFileActivities;
type CoreFileActivities = Omit<
  FileActivities,
  | keyof SeriesPackNativeFileActivitiesV1
  | keyof LibraryHandoffFileActivities
  | keyof MovieFileActivitiesV4
  | keyof RequestedMovieRollbackFileActivitiesV1
  | "inspectAndStageMedia"
  | "promoteMediaFiles"
  | "prepareSeriesPackPublication"
  | "stageSeriesPackMembersV1"
  | "sealSeriesPackStagingV1"
  | "prepareSeriesPackMembersPublicationV1"
  | "sealSeriesPackPublicationIntentV1"
  | "publishSeriesPackMembersV1"
  | "sealSeriesPackPublicationOutcomeV1"
  | "compensateSeriesPackMembersV1"
  | "sealSeriesPackCompensationV1"
  | "rollbackPublishedSeriesPackV1"
  | "cleanupSupersededMediaFile"
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
  ...createPlaybackWorkerActivities(getMediaNetworkRuntime),
  ...createAcquisitionNetworkWorkerActivities(getMediaNetworkRuntime),
  ...createMovieWatchWorkerActivitiesV4(getMediaNetworkRuntime),
  ...createProviderFeedWorkerActivitiesV1(getMediaNetworkRuntime),
  ...createMovieNetworkWorkerActivitiesV4(getMediaNetworkRuntime),
  ...createRequestedMovieRollbackNetworkWorkerActivitiesV1(
    getMediaNetworkRuntime,
  ),
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
  ...createCatalogCoverageWorkerActivities(getMediaNetworkRuntime),
  expandMediaRequest: (input) =>
    withNetwork((activities) => activities.expandMediaRequest(input)),
  dispatchMediaOutbox: () =>
    withNetwork((activities) => activities.dispatchMediaOutbox()),
  ...createSeriesPackFeedWorkerActivities(getMediaNetworkRuntime),
  ...createSeriesPackNativeCompensationNetworkAdapterV1(getMediaNetworkRuntime),
  sweepMediaWork: (input) =>
    createPlexWatchActivities(getMediaNetworkRuntime).sweepMediaWork(input),
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
  ...createSeedingWorkerActivities(getMediaNetworkRuntime),
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
  ...createAcquisitionFileWorkerActivities(getMediaFileRuntime),
  ...createSeriesPackNativeCompensationFileAdapterV1(getMediaFileRuntime),
  ...createMovieFileWorkerActivitiesV4(getMediaFileRuntime),
  ...createRequestedMovieRollbackFileWorkerActivitiesV1(getMediaFileRuntime),
  ...createLibraryHandoffFileActivities(getMediaFileRuntime),
  prepareSubtitleReplacement: (input) =>
    input.movieScope === undefined
      ? withFiles((activities) => activities.prepareSubtitleReplacement(input))
      : callMovieSubtitleReplacementV2(
          getMediaFileRuntime,
          "prepareSubtitleReplacement",
          input,
        ),
  applySubtitleReplacement: (input) =>
    input.movieScope === undefined
      ? withFiles((activities) => activities.applySubtitleReplacement(input))
      : callMovieSubtitleReplacementV2(
          getMediaFileRuntime,
          "applySubtitleReplacement",
          input,
        ),
  reconcileSubtitleReplacement: (input) =>
    input.movieScope === undefined
      ? withFiles((activities) =>
          activities.reconcileSubtitleReplacement(input),
        )
      : callMovieSubtitleReplacementV2(
          getMediaFileRuntime,
          "reconcileSubtitleReplacement",
          input,
        ),
  cleanupSubtitleReplacement: (input) =>
    input.movieScope === undefined
      ? withFiles((activities) => activities.cleanupSubtitleReplacement(input))
      : callMovieSubtitleReplacementV2(
          getMediaFileRuntime,
          "cleanupSubtitleReplacement",
          input,
        ),
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
