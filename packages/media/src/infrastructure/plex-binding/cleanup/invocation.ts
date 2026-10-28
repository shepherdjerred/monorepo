import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";

/** One policy observation and one provenance allowance for the whole current Activity. */
export type CleanupReadInvocation = {
  budget: PublicationAuthorityReadBudget;
  policyTime: Date;
};
export type CleanupObservationInvocation = CleanupReadInvocation & {
  freshness: PlexBindingFreshness;
};
