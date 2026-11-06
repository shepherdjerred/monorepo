import type { MediaFileActivities } from "@shepherdjerred/media/automation";
import type { createMediaFileRuntime } from "@shepherdjerred/media/automation/network";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { compensationCall } from "#activities/media/compensation-execution.ts";

type Runtime = Pick<
  Awaited<ReturnType<typeof createMediaFileRuntime>>,
  "acquisition"
>;
type Names =
  | "rollbackPublishedSeriesPackV1"
  | "prepareSeriesPackMembersPublicationV1"
  | "sealSeriesPackPublicationIntentV1"
  | "publishSeriesPackMembersV1"
  | "sealSeriesPackPublicationOutcomeV1"
  | "compensateSeriesPackMembersV1"
  | "sealSeriesPackCompensationV1";
type Execution = Parameters<
  Runtime["acquisition"]["publishSeriesPackMembersV1"]
>[1];

/** Every actual Activity owns one original100 allowance captured before lazy loading. */
export function createSeriesPackPublicationWorkerActivitiesV1(
  load: () => Promise<Runtime>,
): Pick<MediaFileActivities, Names> {
  const invoke = <Result>(
    phase: string,
    work: (
      runtime: Runtime,
      execution: Execution,
      budget: PublicationAuthorityReadBudget,
    ) => Promise<Result>,
  ) => {
    const observed = { wall: Date.now(), monotonic: performance.now() };
    const budget = new PublicationAuthorityReadBudget();
    return compensationCall(async (sdk) => {
      const runtime = await load();
      sdk.assertActive();
      return work(
        runtime,
        { ...sdk, observed, checkpoint: () => sdk.checkpoint(phase) },
        budget,
      );
    });
  };
  return {
    rollbackPublishedSeriesPackV1: (input) =>
      invoke("series-pack-published-rollback", (runtime, execution, budget) =>
        runtime.acquisition.rollbackPublishedSeriesPackV1(
          input,
          execution,
          budget,
        ),
      ),
    prepareSeriesPackMembersPublicationV1: (input) =>
      invoke(
        "series-pack-publication-prepare-batch",
        (runtime, execution, budget) =>
          runtime.acquisition.prepareSeriesPackMembersPublicationV1(
            input,
            execution,
            budget,
          ),
      ),
    sealSeriesPackPublicationIntentV1: (input) =>
      invoke(
        "series-pack-publication-intent-seal",
        (runtime, execution, budget) =>
          runtime.acquisition.sealSeriesPackPublicationIntentV1(
            input,
            execution,
            budget,
          ),
      ),
    publishSeriesPackMembersV1: (input) =>
      invoke(
        "series-pack-publication-physical-batch",
        (runtime, execution, budget) =>
          runtime.acquisition.publishSeriesPackMembersV1(
            input,
            execution,
            budget,
          ),
      ),
    sealSeriesPackPublicationOutcomeV1: (input) =>
      invoke(
        "series-pack-publication-outcome-seal",
        (runtime, execution, budget) =>
          runtime.acquisition.sealSeriesPackPublicationOutcomeV1(
            input,
            execution,
            budget,
          ),
      ),
    compensateSeriesPackMembersV1: (input) =>
      invoke(
        "series-pack-publication-inverse-batch",
        (runtime, execution, budget) =>
          runtime.acquisition.compensateSeriesPackMembersV1(
            input,
            execution,
            budget,
          ),
      ),
    sealSeriesPackCompensationV1: (input) =>
      invoke(
        "series-pack-publication-compensation-seal",
        (runtime, execution, budget) =>
          runtime.acquisition.sealSeriesPackCompensationV1(
            input,
            execution,
            budget,
          ),
      ),
  };
}
