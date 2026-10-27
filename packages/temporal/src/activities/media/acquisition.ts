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
): Pick<MediaFileActivities, "inspectAndStageMedia" | "promoteMediaFiles"> {
  return {
    inspectAndStageMedia: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.acquisition.inspectAndStageMedia(input, {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint("media-inspection"),
        });
      });
    },
    promoteMediaFiles: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.acquisition.promoteMediaFiles(input, {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint("media-publication"),
        });
      });
    },
  };
}
