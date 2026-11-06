import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { SeriesPackNativeFileExecutionV1 } from "#shared/native-recovery/series-pack/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type {
  SeriesPackNativeActivityV1,
  SeriesPackNativeReviewV1,
  SeriesPackNativeApplyV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import {
  prepareSeriesPackNativeCompensationV1,
  applySeriesPackNativeCompensationV1,
} from "./approval.ts";
import { compensateSeriesPackNativePublicationV1 } from "./execute.ts";

/** Cached facet retains only the actual NativeFileContext. Each call receives
 * its real compensationRuntimeCall SDK and exactly one original allowance. */
export function createSeriesPackNativeCompensationFileFacetV1(
  context: NativeFileContext,
) {
  return {
    prepareSeriesPackNativeCompensationV1: (
      input: SeriesPackNativeReviewV1,
      execution: SeriesPackNativeFileExecutionV1,
      budget: PublicationAuthorityReadBudget,
    ) =>
      prepareSeriesPackNativeCompensationV1(context, input, execution, budget),
    applySeriesPackNativeCompensationV1: (
      input: SeriesPackNativeApplyV1,
      execution: SeriesPackNativeFileExecutionV1,
      budget: PublicationAuthorityReadBudget,
    ) => applySeriesPackNativeCompensationV1(context, input, execution, budget),
    compensateSeriesPackNativePublicationV1: (
      input: SeriesPackNativeActivityV1,
      execution: SeriesPackNativeFileExecutionV1,
      budget: PublicationAuthorityReadBudget,
    ) =>
      compensateSeriesPackNativePublicationV1(
        context,
        input,
        execution,
        budget,
      ),
  };
}
