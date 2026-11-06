import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MediaAttemptOperation } from "#shared/automation.ts";
import type {
  SeriesPackStagingInputV1,
  SeriesPackStagingBatchResultV1,
  SeriesPackStagingSealResultV1,
} from "#shared/acquisition/series-pack-staging-v1.ts";
import { stageSeriesPackMembersV1 } from "./batch.ts";
import { sealSeriesPackStagingV1 } from "./seal.ts";

function stagingFailure(
  error: unknown,
): Exclude<SeriesPackStagingSealResultV1, { status: "staged" }> {
  if (error instanceof FileGuardError)
    return {
      status: error.reason.includes("obsolete") ? "obsolete" : "blocked",
      reason: error.reason,
    };
  if (error instanceof MediaError)
    return { status: "blocked", reason: error.code };
  throw error;
}

/** Original SDK and allowance are supplied before lazy runtime loading; neither is serializable. */
export function createSeriesPackStagingFileFacetV1(context: FileContext) {
  const invocation = (execution: PublicationExecution) => {
    execution.assertActive();
    execution.signal.throwIfAborted();
    return { ...context, publicationExecution: () => execution };
  };
  return {
    stageSeriesPackMembersV1: async (
      input: SeriesPackStagingInputV1,
      execution: PublicationExecution,
      budget: PublicationAuthorityReadBudget,
    ): Promise<SeriesPackStagingBatchResultV1> => {
      try {
        return await stageSeriesPackMembersV1(
          invocation(execution),
          input,
          budget,
        );
      } catch (error) {
        return stagingFailure(error);
      }
    },
    sealSeriesPackStagingV1: async (
      input: MediaAttemptOperation,
      execution: PublicationExecution,
      budget: PublicationAuthorityReadBudget,
    ): Promise<SeriesPackStagingSealResultV1> => {
      try {
        return await sealSeriesPackStagingV1(
          invocation(execution),
          input,
          budget,
        );
      } catch (error) {
        return stagingFailure(error);
      }
    },
  };
}
