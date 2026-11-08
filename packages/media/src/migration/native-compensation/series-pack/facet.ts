import type { MediaAutomationContext } from "#automation/context.ts";
import type { NativePlexContext } from "#migration/native-plex/producer.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type {
  SeriesPackNativeReviewV1,
  SeriesPackNativeActivityV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import {
  observeSeriesPackNativeCompensationV1,
  observeSeriesPackNativeCompensationExecutionV1,
} from "./observe.ts";
import { seriesPackNativeCompensationStateV1 } from "./state.ts";
import { publishSeriesPackNativeCompensationV1 } from "#automation/native-compensation/series-pack/publication.ts";

/** No SDK factory or counter is retained by this cached runtime facet. */
export function createSeriesPackNativeCompensationNetworkFacetV1(
  context: NativePlexContext & MediaAutomationContext,
) {
  return {
    observeSeriesPackNativeCompensationV1: (
      input: SeriesPackNativeReviewV1,
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) =>
      observeSeriesPackNativeCompensationV1(context, input, execution, budget),
    observeSeriesPackNativeCompensationExecutionV1: (
      input: SeriesPackNativeActivityV1,
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) =>
      observeSeriesPackNativeCompensationExecutionV1(
        context,
        input,
        execution,
        budget,
      ),
    seriesPackNativeCompensationStateV1: (
      input: SeriesPackNativeActivityV1,
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) => seriesPackNativeCompensationStateV1(context, input, execution, budget),
    publishSeriesPackNativeCompensationV1: (
      input: SeriesPackNativeActivityV1,
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) =>
      publishSeriesPackNativeCompensationV1(context, input, execution, budget),
  };
}
