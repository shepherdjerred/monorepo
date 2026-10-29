import type {
  NativeCompensationNetworkActivities,
  NativeCompensationFileActivities,
} from "@shepherdjerred/media/native-compensation";
import {
  getMediaNetworkRuntime,
  getMediaFileRuntime,
} from "#activities/media.ts";
import {
  compensationRuntimeCall,
  type compensationExecution,
} from "./compensation-execution.ts";
import { createPlexCompensatedPublication } from "./plex-publication.ts";
import {
  createNativePlexReviewActivities,
  createNativePlexCompensationExecution,
} from "./native-plex.ts";

export const nativeCompensationNetworkActivities: NativeCompensationNetworkActivities =
  {
    observeNativeCompensation: (input) =>
      createNativePlexReviewActivities(
        getMediaNetworkRuntime,
      ).observeNativeCompensation(input),
    observeNativeCompensationExecution: (input) =>
      createNativePlexCompensationExecution(getMediaNetworkRuntime)(input),
    publishCompensatedMedia: createPlexCompensatedPublication(
      getMediaNetworkRuntime,
    ),
    nativeCompensationState: (input) =>
      withNetwork((runtime) =>
        runtime.activities.nativeCompensationState(input),
      ),
  };
type CompensationFileRuntime = {
  nativeFiles: {
    compensation: (
      execution: ReturnType<typeof compensationExecution>,
    ) => NativeCompensationFileActivities;
  };
};

export function createNativeCompensationFileAdapter(
  load: () => Promise<CompensationFileRuntime>,
): NativeCompensationFileActivities {
  const withFiles = <T>(
    work: (activities: NativeCompensationFileActivities) => Promise<T>,
  ) =>
    compensationRuntimeCall(load, (runtime, execution) =>
      work(runtime.nativeFiles.compensation(execution)),
    );
  return {
    prepareNativeCompensationFiles: (input) =>
      withFiles((activities) =>
        activities.prepareNativeCompensationFiles(input),
      ),
    applyNativeCompensationFiles: (input) =>
      withFiles((activities) => activities.applyNativeCompensationFiles(input)),
    compensateNativePublicationFiles: (input) =>
      withFiles((activities) =>
        activities.compensateNativePublicationFiles(input),
      ),
  };
}

export const nativeCompensationFileActivities =
  createNativeCompensationFileAdapter(getMediaFileRuntime);

function withNetwork<T>(
  work: (
    runtime: Awaited<ReturnType<typeof getMediaNetworkRuntime>>,
  ) => Promise<T>,
) {
  return compensationRuntimeCall(getMediaNetworkRuntime, work);
}
