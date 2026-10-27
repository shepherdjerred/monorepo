import { MediaError } from "#application/errors.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type {
  PlexAccess,
  PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";

export type LibraryManagementInvocation = {
  freshness: PlexBindingFreshness;
  budget: PublicationAuthorityReadBudget;
  access: PlexAccess;
};

export function protectLibraryManagement(): never {
  throw new MediaError(
    "library_management_unconfirmed",
    "Existing-library monitoring needs its current owner-approved policy",
    409,
  );
}
