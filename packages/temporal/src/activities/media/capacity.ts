import type { CapacityActivities } from "@shepherdjerred/media/capacity";
import {
  getMediaFileRuntime,
  getMediaNetworkRuntime,
} from "#activities/media.ts";
import { capacityCall } from "./capacity-execution.ts";

export const capacityNetworkActivities: Pick<
  CapacityActivities,
  "observeMediaCapacityMounts"
> = {
  observeMediaCapacityMounts: () =>
    capacityCall(async (execution) => {
      const runtime = await getMediaNetworkRuntime();
      return await runtime.capacity.observeMediaCapacityMounts(execution);
    }),
};
export const capacityFileActivities: Pick<
  CapacityActivities,
  "sampleMediaCapacity"
> = {
  sampleMediaCapacity: (cycle) =>
    capacityCall(async (execution) => {
      const runtime = await getMediaFileRuntime();
      return await runtime.capacity.sampleMediaCapacity(cycle, execution);
    }),
};
