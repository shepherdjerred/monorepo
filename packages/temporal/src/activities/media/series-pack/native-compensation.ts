import type {
  SeriesPackNativeFileActivitiesV1,
  SeriesPackNativeNetworkActivitiesV1,
  SeriesPackNativeFileExecutionV1,
} from "@shepherdjerred/media/native-series-pack-compensation";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { compensationCall } from "#activities/media/compensation-execution.ts";
import { plexBindingCall } from "#activities/media/plex-binding-execution.ts";

type Files = {
  seriesPackNativeCompensation: {
    [Method in keyof SeriesPackNativeFileActivitiesV1]: (
      ...args: [
        ...Parameters<SeriesPackNativeFileActivitiesV1[Method]>,
        SeriesPackNativeFileExecutionV1,
        PublicationAuthorityReadBudget,
      ]
    ) => ReturnType<SeriesPackNativeFileActivitiesV1[Method]>;
  };
};
type Network = {
  seriesPackNativeCompensation: {
    [Method in keyof SeriesPackNativeNetworkActivitiesV1]: (
      ...args: [
        ...Parameters<SeriesPackNativeNetworkActivitiesV1[Method]>,
        PlexBindingExecution,
        PublicationAuthorityReadBudget,
      ]
    ) => ReturnType<SeriesPackNativeNetworkActivitiesV1[Method]>;
  };
};

/** Every call retains its original SDK, observation and one allowance before lazy loading. */
export function createSeriesPackNativeCompensationFileAdapterV1(
  load: () => Promise<Files>,
): SeriesPackNativeFileActivitiesV1 {
  function invoke<T>(
    dispatch: (
      facet: Files["seriesPackNativeCompensation"],
      execution: SeriesPackNativeFileExecutionV1,
      budget: PublicationAuthorityReadBudget,
    ) => Promise<T>,
  ) {
    const observed = { wall: Date.now(), monotonic: performance.now() };
    const budget = new PublicationAuthorityReadBudget();
    return compensationCall(async (sdk) => {
      const runtime = await load();
      sdk.assertActive();
      return dispatch(
        runtime.seriesPackNativeCompensation,
        { ...sdk, observed },
        budget,
      );
    });
  }
  return {
    prepareSeriesPackNativeCompensationV1: (input) =>
      invoke((facet, execution, budget) =>
        facet.prepareSeriesPackNativeCompensationV1(input, execution, budget),
      ),
    applySeriesPackNativeCompensationV1: (input) =>
      invoke((facet, execution, budget) =>
        facet.applySeriesPackNativeCompensationV1(input, execution, budget),
      ),
    compensateSeriesPackNativePublicationV1: (input) =>
      invoke((facet, execution, budget) =>
        facet.compensateSeriesPackNativePublicationV1(input, execution, budget),
      ),
  };
}

export function createSeriesPackNativeCompensationNetworkAdapterV1(
  load: () => Promise<Network>,
): SeriesPackNativeNetworkActivitiesV1 {
  function invoke<T>(
    dispatch: (
      facet: Network["seriesPackNativeCompensation"],
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) => Promise<T>,
  ) {
    const budget = new PublicationAuthorityReadBudget();
    return plexBindingCall(async (execution) => {
      const runtime = await load();
      execution.assertActive();
      return dispatch(runtime.seriesPackNativeCompensation, execution, budget);
    });
  }
  return {
    observeSeriesPackNativeCompensationV1: (input) =>
      invoke((facet, execution, budget) =>
        facet.observeSeriesPackNativeCompensationV1(input, execution, budget),
      ),
    observeSeriesPackNativeCompensationExecutionV1: (input) =>
      invoke((facet, execution, budget) =>
        facet.observeSeriesPackNativeCompensationExecutionV1(
          input,
          execution,
          budget,
        ),
      ),
    seriesPackNativeCompensationStateV1: (input) =>
      invoke((facet, execution, budget) =>
        facet.seriesPackNativeCompensationStateV1(input, execution, budget),
      ),
    publishSeriesPackNativeCompensationV1: (input) =>
      invoke((facet, execution, budget) =>
        facet.publishSeriesPackNativeCompensationV1(input, execution, budget),
      ),
  };
}
