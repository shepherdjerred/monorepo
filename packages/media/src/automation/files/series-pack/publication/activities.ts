import type { FileContext } from "#automation/files/types.ts";
import {
  requirePublicationExecution,
  type PublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createSeriesPackBoundedPublicationFileFacetV1 } from "./facet.ts";

export function createSeriesPackBoundedPublicationActivitiesV1(
  context: FileContext,
) {
  const facet = createSeriesPackBoundedPublicationFileFacetV1(context);
  const bind =
    <Input, Result>(
      work: (
        input: Input,
        execution: PublicationExecution,
        budget: PublicationAuthorityReadBudget,
      ) => Promise<Result>,
    ) =>
    (input: Input) => {
      const execution = requirePublicationExecution(
        context.publicationExecution?.(),
      );
      const budget =
        context.libraryManagement?.budget ??
        new PublicationAuthorityReadBudget();
      return work(input, execution, budget);
    };
  return {
    rollbackPublishedSeriesPackV1: bind(facet.rollbackPublishedSeriesPackV1),
    prepareSeriesPackMembersPublicationV1: bind(
      facet.prepareSeriesPackMembersPublicationV1,
    ),
    sealSeriesPackPublicationIntentV1: bind(
      facet.sealSeriesPackPublicationIntentV1,
    ),
    publishSeriesPackMembersV1: bind(facet.publishSeriesPackMembersV1),
    sealSeriesPackPublicationOutcomeV1: bind(
      facet.sealSeriesPackPublicationOutcomeV1,
    ),
    compensateSeriesPackMembersV1: bind(facet.compensateSeriesPackMembersV1),
    sealSeriesPackCompensationV1: bind(facet.sealSeriesPackCompensationV1),
  };
}
