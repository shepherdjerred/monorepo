import type {
  NativeArchiveNetworkActivities,
  NativeArchiveFileActivities,
} from "@shepherdjerred/media/native-archive";
import {
  getMediaNetworkRuntime,
  getMediaFileRuntime,
} from "#activities/media.ts";
import { archiveCall, type archiveExecution } from "./archive-execution.ts";
import {
  createNativePlexReviewActivities,
  createNativePlexArchiveCleanup,
} from "./native-plex.ts";

export const nativeArchiveNetworkActivities: NativeArchiveNetworkActivities = {
  observeNativeArchive: (input) =>
    createNativePlexReviewActivities(
      getMediaNetworkRuntime,
    ).observeNativeArchive(input),
  observeNativeArchiveCleanup: (input) =>
    createNativePlexArchiveCleanup(getMediaNetworkRuntime)(input),
  nativeArchiveCleanupState: (input) =>
    archiveCall(async () => {
      const runtime = await getMediaNetworkRuntime();
      return runtime.activities.nativeArchiveCleanupState(input);
    }),
};
type ArchiveFileRuntime = {
  nativeFiles: {
    archive: (
      execution: ReturnType<typeof archiveExecution>,
    ) => NativeArchiveFileActivities;
  };
};

export function createNativeArchiveFileAdapter(
  load: () => Promise<ArchiveFileRuntime>,
): NativeArchiveFileActivities {
  const withFiles = <T>(
    work: (activities: NativeArchiveFileActivities) => Promise<T>,
  ) =>
    archiveCall(async (execution) => {
      const runtime = await load();
      execution.assertActive();
      return work(runtime.nativeFiles.archive(execution));
    });
  return {
    prepareNativeArchiveFiles: (input) =>
      withFiles((activities) => activities.prepareNativeArchiveFiles(input)),
    applyNativeArchiveFiles: (input) =>
      withFiles((activities) => activities.applyNativeArchiveFiles(input)),
    cleanupNativeArchiveFiles: (input) =>
      withFiles((activities) => activities.cleanupNativeArchiveFiles(input)),
  };
}

export const nativeArchiveFileActivities =
  createNativeArchiveFileAdapter(getMediaFileRuntime);
