import type { Prisma } from "#generated/prisma/client.ts";
import { currentFulfillmentAsset } from "#automation/editions/fulfillment.ts";
import {
  boundRequesterWatch,
  type BoundMediaCohort,
} from "#automation/retention/binding.ts";
import { RETENTION_DEFAULTS } from "#domain/retention.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { readMovieDemandAuthority } from "#infrastructure/movie-editions/fulfillment.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
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

async function memberRequestersWatched(
  tx: Prisma.TransactionClient,
  context: RequesterWatchContext & {
    binding: NonNullable<RequesterWatchContext["binding"]>;
  },
  member: BoundMediaCohort["original"][number],
): Promise<boolean> {
  const mediaId = member.authority.binding.scope.mediaId;
  const movieScope = context.binding.cohort.movieScope;
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: mediaId },
  });
  if (media.kind === "movie") {
    const { demands, freshness } = await readMovieDemandAuthority(tx, {
      mediaId,
      currentAsset: await currentFulfillmentAsset(
        tx,
        mediaId,
        movieScope?.edition,
      ),
      access: requireMovieChoiceAccess(context.movieAccess ?? {}),
      ...(movieScope === undefined ? {} : { scope: movieScope }),
      ...(context.binding.budget === undefined
        ? {}
        : { budget: context.binding.budget }),
    });
    if (demands.some((demand) => demand.fulfillment.status !== "fulfilled"))
      return false;
    if (freshness !== null) context.captureFreshness?.(freshness);
  }
  const claims = await tx.mediaRequest.findMany({
    where: {
      mediaId,
      ...effectiveRequestWhere,
      edition: movieScope?.edition ?? "default",
      user: { role: { not: "owner" } },
    },
  });
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
  const watched =
    claims.length > 0 &&
    claims.every((claim) =>
      observations.some(
        (observation) =>
          observation !== null &&
          observation.userId === claim.userId &&
          observation.watched &&
          Date.parse(observation.observedAt) <= now &&
          now - Date.parse(observation.observedAt) <=
            RETENTION_DEFAULTS.maximumWatchAgeMs,
      ),
    );
  context.binding.freshness.assertActive();
  return watched;
}

export async function allRequestersWatched(
  tx: Prisma.TransactionClient,
  context: RequesterWatchContext,
): Promise<boolean> {
  const binding = context.binding;
  if (binding === undefined) return false;
  for (const member of binding.cohort.original) {
    if (!(await memberRequestersWatched(tx, { ...context, binding }, member)))
      return false;
  }
  return true;
}
