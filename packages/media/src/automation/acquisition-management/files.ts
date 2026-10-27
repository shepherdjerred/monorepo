import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { managedSeriesIdentity } from "#shared/acquisition/library-management.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { publicationDeadline } from "#automation/publication-proof/invocation.ts";

/** The Files root retains its original execution; repeated authorization shares one traversal allowance. */
export async function libraryFileInvocation(
  context: PublicationContext,
  rawIdentity: unknown,
  budget: PublicationAuthorityReadBudget,
) {
  if (managedSeriesIdentity(rawIdentity) === null) return context;
  const freshness = publicationDeadline(
    context.execution,
    context.execution.expiresAtMs,
  );
  const access = await context.plexAccess("show");
  freshness.assertActive();
  return {
    ...context,
    libraryManagement: { freshness, budget, access },
  };
}
