import type {
  NativeCompensationNetworkActivities,
  NativeCompensationFileActivities,
} from "@shepherdjerred/media/native-compensation";
import {
  getMediaNetworkRuntime,
  getMediaFileRuntime,
} from "#activities/media.ts";
import { compensationRuntimeCall } from "./compensation-execution.ts";

export const nativeCompensationNetworkActivities: NativeCompensationNetworkActivities =
  {
    observeNativeCompensation: (input) =>
      withNetwork((runtime) =>
        runtime.activities.observeNativeCompensation(input),
      ),
    observeNativeCompensationExecution: (input) =>
      withNetwork((runtime) =>
        runtime.activities.observeNativeCompensationExecution(input),
      ),
    publishCompensatedMedia: (input) =>
      withNetwork((runtime) =>
        runtime.activities.publishCompensatedMedia(input),
      ),
    nativeCompensationState: (input) =>
      withNetwork((runtime) =>
        runtime.activities.nativeCompensationState(input),
      ),
  };
export const nativeCompensationFileActivities: NativeCompensationFileActivities =
  {
    prepareNativeCompensationFiles: (input) =>
      withFiles((runtime) =>
        runtime.activities.prepareNativeCompensationFiles(input),
      ),
    applyNativeCompensationFiles: (input) =>
      withFiles((runtime) =>
        runtime.activities.applyNativeCompensationFiles(input),
      ),
    compensateNativePublicationFiles: (input) =>
      withFiles((runtime) =>
        runtime.activities.compensateNativePublicationFiles(input),
      ),
  };

function withNetwork<T>(
  work: (
    runtime: Awaited<ReturnType<typeof getMediaNetworkRuntime>>,
  ) => Promise<T>,
) {
  return compensationRuntimeCall(getMediaNetworkRuntime, work);
}
function withFiles<T>(
  work: (
    runtime: Awaited<ReturnType<typeof getMediaFileRuntime>>,
  ) => Promise<T>,
) {
  return compensationRuntimeCall(getMediaFileRuntime, work);
}
