import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { prepareSeriesPackMembersPublicationV1 } from "./prepare.ts";
import { sealSeriesPackPublicationIntentV1 } from "./intent.ts";
import { publishSeriesPackMembersV1 } from "./physical.ts";
import { sealSeriesPackPublicationOutcomeV1 } from "./complete.ts";
import { compensateSeriesPackMembersV1 } from "./inverse.ts";
import { sealSeriesPackCompensationV1 } from "./compensated.ts";
import { rollbackPublishedSeriesPackV1 } from "./rollback.ts";
import type { MediaAttemptOperation } from "#shared/automation.ts";

function publicationFailure(error: unknown) {
  if (error instanceof FileGuardError)
    return {
      status: error.reason.includes("obsolete")
        ? ("obsolete" as const)
        : ("blocked" as const),
      reason: error.reason,
    };
  if (error instanceof MediaError)
    return { status: "blocked" as const, reason: error.code };
  throw error;
}

/** Each method retains the worker's exact original pre-lazy-load SDK and one read allowance. */
export function createSeriesPackBoundedPublicationFileFacetV1(
  context: FileContext,
) {
  function bind<Input, Result>(
    work: (
      context: FileContext,
      input: Input,
      budget: PublicationAuthorityReadBudget,
    ) => Promise<Result>,
  ) {
    return async (
      input: Input,
      execution: PublicationExecution,
      budget: PublicationAuthorityReadBudget,
    ) => {
      execution.assertActive();
      execution.signal.throwIfAborted();
      try {
        return await work(
          { ...context, publicationExecution: () => execution },
          input,
          budget,
        );
      } catch (error) {
        return publicationFailure(error);
      }
    };
  }
  return {
    rollbackPublishedSeriesPackV1: async (
      input: MediaAttemptOperation,
      execution: PublicationExecution,
      budget: PublicationAuthorityReadBudget,
    ) => {
      const result = await bind(rollbackPublishedSeriesPackV1)(
        input,
        execution,
        budget,
      );
      if (result.status === "rolled_back") return result;
      return {
        status:
          result.status === "blocked"
            ? ("protected" as const)
            : ("obsolete" as const),
        reason: result.reason,
      };
    },
    prepareSeriesPackMembersPublicationV1: bind(
      prepareSeriesPackMembersPublicationV1,
    ),
    sealSeriesPackPublicationIntentV1: bind(sealSeriesPackPublicationIntentV1),
    publishSeriesPackMembersV1: bind(publishSeriesPackMembersV1),
    sealSeriesPackPublicationOutcomeV1: bind(
      sealSeriesPackPublicationOutcomeV1,
    ),
    compensateSeriesPackMembersV1: bind(compensateSeriesPackMembersV1),
    sealSeriesPackCompensationV1: bind(sealSeriesPackCompensationV1),
  };
}
