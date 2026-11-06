import type { MediaFileActivities } from "@shepherdjerred/media/automation";
import type { createMediaFileRuntime } from "@shepherdjerred/media/automation/network";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { compensationCall } from "#activities/media/compensation-execution.ts";

/** Each actual batch Activity captures its single original allowance before lazy runtime loading. */
export function createSeriesPackStagingWorkerActivitiesV1(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaFileRuntime>>, "acquisition">
  >,
): Pick<
  MediaFileActivities,
  "stageSeriesPackMembersV1" | "sealSeriesPackStagingV1"
> {
  return {
    stageSeriesPackMembersV1: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      const budget = new PublicationAuthorityReadBudget();
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.acquisition.stageSeriesPackMembersV1(
          input,
          {
            ...sdk,
            observed,
            checkpoint: () => sdk.checkpoint("series-pack-member-staging"),
          },
          budget,
        );
      });
    },
    sealSeriesPackStagingV1: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      const budget = new PublicationAuthorityReadBudget();
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.acquisition.sealSeriesPackStagingV1(
          input,
          {
            ...sdk,
            observed,
            checkpoint: () => sdk.checkpoint("series-pack-staging-seal"),
          },
          budget,
        );
      });
    },
  };
}
