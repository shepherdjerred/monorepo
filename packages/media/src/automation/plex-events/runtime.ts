import type { MediaAutomationContext } from "#automation/context.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { createPlexEventActivities } from "./activities.ts";

/** A fresh immutable view for one Activity; the cached runtime owns no invocation state. */
export function watchInvocation(
  context: MediaAutomationContext,
  execution: PlexBindingExecution,
  hintsEnabled: () => Promise<boolean>,
  budget?: PublicationAuthorityReadBudget,
) {
  const invocation = {
    ...context,
    plexBindingExecution: () => execution,
    watchExecution: () => execution,
    ...(budget === undefined || context.movieManagement !== undefined
      ? {}
      : { movieManagement: { execution, budget } }),
  };
  return {
    ...createRetentionActivities(invocation),
    ...createSweepActivities(invocation),
    ...createPlexEventActivities(invocation, hintsEnabled),
  };
}
