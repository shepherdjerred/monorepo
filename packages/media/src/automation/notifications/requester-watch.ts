import type { Prisma } from "#generated/prisma/client.ts";
import {
  boundRequesterWatch,
  type BoundMediaCohort,
} from "#automation/retention/binding.ts";
import { RETENTION_DEFAULTS } from "#domain/retention.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { householdRetentionState } from "#infrastructure/request-interest/protection.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export type RequesterWatchContext = {
  movieAccess?: MovieChoiceAccess | undefined;
  captureFreshness?: ((guard: MovieChoiceFreshness) => void) | undefined;
  binding?:
    | {
        cohort: BoundMediaCohort;
        freshness: PlexBindingFreshness;
        observed: { wall: number; monotonic: number };
        budget?: PublicationAuthorityReadBudget;
      }
    | undefined;
};

async function memberInterestsReleased(
  tx: Prisma.TransactionClient,
  context: RequesterWatchContext & {
    binding: NonNullable<RequesterWatchContext["binding"]>;
  },
  member: BoundMediaCohort["original"][number],
): Promise<boolean> {
  const mediaId = member.authority.binding.scope.mediaId;
  const household = await householdRetentionState(
    tx,
    mediaId,
    context.binding.cohort.movieScope?.edition ?? "default",
  );
  if (household.reason !== null) return false;
  const claims = household.recipients;
  const observations = await Promise.all(
    claims.map((claim) =>
      boundRequesterWatch(tx, member, claim.userId, context.binding.budget),
    ),
  );
  for (const observation of observations) {
    if (observation !== null)
      context.captureFreshness?.(
        plexBindingFreshness({
          observed: context.binding.observed,
          expiresAtMs: Math.min(
            context.binding.freshness.expiresAtMs,
            Date.parse(observation.observedAt) +
              RETENTION_DEFAULTS.maximumWatchAgeMs,
          ),
          guards: [context.binding.freshness],
        }),
      );
  }
  const now = Date.now();
  const confirmed =
    claims.length > 0 &&
    claims.every((claim) =>
      observations.some(
        (observation) =>
          observation !== null &&
          observation.userId === claim.userId &&
          Date.parse(observation.observedAt) <= now &&
          now - Date.parse(observation.observedAt) <=
            RETENTION_DEFAULTS.maximumWatchAgeMs,
      ),
    );
  context.binding.freshness.assertActive();
  return confirmed;
}

export async function allHouseholdInterestsReleased(
  tx: Prisma.TransactionClient,
  context: RequesterWatchContext,
): Promise<boolean> {
  const binding = context.binding;
  if (binding === undefined) return false;
  for (const member of binding.cohort.original) {
    if (!(await memberInterestsReleased(tx, { ...context, binding }, member)))
      return false;
  }
  return true;
}
