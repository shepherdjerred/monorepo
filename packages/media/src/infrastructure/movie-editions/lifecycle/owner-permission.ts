import type { Prisma } from "#generated/prisma/client.ts";
import {
  movieChoiceSubject,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { FileGuardError } from "#automation/files/types.ts";

type Invocation = {
  budget: MovieManagementInvocation["budget"];
  execution: Pick<
    MovieManagementInvocation["execution"],
    "observed" | "expiresAtMs" | "assertActive"
  >;
};

/** The explicit actor authorizes their own current owner action, independently of old requesters. */
export async function captureMovieOwnerPermissionV1(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: { access: MovieChoiceAccess; invocation: Invocation },
) {
  const execution = input.invocation.execution;
  execution.assertActive();
  const owner = await movieChoiceSubject(tx, {
    actorId,
    subjectUserId: actorId,
    purpose: "choose",
    access: input.access,
    mediaSectionId: input.access.movieSectionId,
  });
  input.invocation.budget.consume(owner.mapping === null ? 2 : 3);
  if (
    owner.actor.role !== "owner" ||
    owner.actor.restricted ||
    owner.freshness === null
  )
    throw new FileGuardError("movie_owner_action_not_authorized");
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(execution.expiresAtMs, owner.freshness.expiresAtMs),
    guards: [execution, owner.freshness],
  });
  freshness.assertActive();
  return freshness;
}
