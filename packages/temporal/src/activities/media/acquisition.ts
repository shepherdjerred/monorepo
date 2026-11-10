import type {
  MediaNetworkActivities,
  MediaFileActivities,
} from "@shepherdjerred/media/automation";
import type {
  createMediaNetworkRuntime,
  createMediaFileRuntime,
} from "@shepherdjerred/media/automation/network";
import { plexBindingCall } from "./plex-binding-execution.ts";
import { compensationCall } from "./compensation-execution.ts";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { createSeriesPackStagingWorkerActivitiesV1 } from "./series-pack/staging.ts";
import { createSeriesPackPublicationWorkerActivitiesV1 } from "./series-pack/publication.ts";
import { ApplicationFailure } from "@temporalio/activity";

/** Local invocation expiry is retryable; a new Activity still reacquires every real guard. */
function retryPublicationExpiry<T extends { status: string; reason?: string }>(
  result: T,
): T {
  if (
    result.status === "blocked" &&
    result.reason === "publication_authority_expired"
  )
    throw ApplicationFailure.create({
      message: "Media publication invocation expired",
      type: "MediaPublicationInvocationExpired",
    });
  return result;
}

/** Preserve Activity names and arguments; the SDK capability is never serialized into history. */
export function createAcquisitionNetworkWorkerActivities(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaNetworkRuntime>>, "acquisition">
  >,
): Pick<
  MediaNetworkActivities,
  "reconcileMediaIntent" | "submitMediaTorrent" | "observeMediaAcquisition"
> {
  return {
    reconcileMediaIntent: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.acquisition.reconcileMediaIntent(input, execution);
      }),
    submitMediaTorrent: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.acquisition.submitMediaTorrent(input, execution);
      }),
    observeMediaAcquisition: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.acquisition.observeMediaAcquisition(input, execution);
      }),
  };
}

export function createAcquisitionFileWorkerActivities(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaFileRuntime>>, "acquisition">
  >,
): Pick<
  MediaFileActivities,
  | "inspectAndStageMedia"
  | "promoteMediaFiles"
  | "cleanupSupersededMediaFile"
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
> {
  return {
    ...createSeriesPackStagingWorkerActivitiesV1(load),
    ...createSeriesPackPublicationWorkerActivitiesV1(load),
    prepareSeriesPackPublication: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      const budget = new PublicationAuthorityReadBudget();
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.acquisition.prepareSeriesPackPublication(
          input,
          {
            ...sdk,
            observed,
            checkpoint: () => sdk.checkpoint("series-pack-publication-prepare"),
          },
          budget,
        );
      });
    },
    cleanupSupersededMediaFile: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.acquisition.cleanupSupersededMediaFile(input, {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint("media-upgrade-cleanup"),
        });
      });
    },
    inspectAndStageMedia: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return retryPublicationExpiry(
          await runtime.acquisition.inspectAndStageMedia(input, {
            ...sdk,
            observed,
            checkpoint: () => sdk.checkpoint("media-inspection"),
          }),
        );
      });
    },
    promoteMediaFiles: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return retryPublicationExpiry(
          await runtime.acquisition.promoteMediaFiles(input, {
            ...sdk,
            observed,
            checkpoint: () => sdk.checkpoint("media-publication"),
          }),
        );
      });
    },
  };
}
