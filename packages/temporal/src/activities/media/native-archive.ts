import type {
  NativeArchiveNetworkActivities,
  NativeArchiveFileActivities,
} from "@shepherdjerred/media/native-archive";
import {
  getMediaNetworkRuntime,
  getMediaFileRuntime,
} from "#activities/media.ts";
import { archiveCall } from "./archive-execution.ts";

export const nativeArchiveNetworkActivities: NativeArchiveNetworkActivities = {
  observeNativeArchive: (input) =>
    archiveCall(async () => {
      const runtime = await getMediaNetworkRuntime();
      return runtime.activities.observeNativeArchive(input);
    }),
  observeNativeArchiveCleanup: (input) =>
    archiveCall(async () => {
      const runtime = await getMediaNetworkRuntime();
      return runtime.activities.observeNativeArchiveCleanup(input);
    }),
  nativeArchiveCleanupState: (input) =>
    archiveCall(async () => {
      const runtime = await getMediaNetworkRuntime();
      return runtime.activities.nativeArchiveCleanupState(input);
    }),
};
export const nativeArchiveFileActivities: NativeArchiveFileActivities = {
  prepareNativeArchiveFiles: (input) =>
    archiveCall(async () => {
      const runtime = await getMediaFileRuntime();
      return runtime.activities.prepareNativeArchiveFiles(input);
    }),
  applyNativeArchiveFiles: (input) =>
    archiveCall(async () => {
      const runtime = await getMediaFileRuntime();
      return runtime.activities.applyNativeArchiveFiles(input);
    }),
  cleanupNativeArchiveFiles: (input) =>
    archiveCall(async () => {
      const runtime = await getMediaFileRuntime();
      return runtime.activities.cleanupNativeArchiveFiles(input);
    }),
};
