import type { MediaAutomationContext } from "#automation/context.ts";
import type { MatchFeedSourceV1 } from "#shared/feeds/contract.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { matchSeriesPackFeedSourceV1 } from "./matching.ts";

/** The worker supplies both original capabilities before its first lazy/configuration await. */
export function createSeriesPackFeedFacetV1(context: MediaAutomationContext) {
  return async (
    input: MatchFeedSourceV1,
    execution: PlexBindingExecution,
    budget: PublicationAuthorityReadBudget,
  ) => {
    execution.assertActive();
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: execution.expiresAtMs,
      guards: [execution],
    });
    const access = await context.plexAccess("show");
    freshness.assertActive();
    const invocation = context.libraryManagement ?? {
      access,
      freshness,
      budget,
    };
    if (invocation.budget !== budget)
      throw new Error(
        "Series pack feed cannot replace its original caller allowance",
      );
    return matchSeriesPackFeedSourceV1(
      {
        ...context,
        plexBindingExecution: () => execution,
        libraryManagement: invocation,
      },
      input,
    );
  };
}
