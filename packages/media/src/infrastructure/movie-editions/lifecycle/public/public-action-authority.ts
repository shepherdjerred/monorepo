import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import {
  movieChoiceSubject,
  movieSourceSection,
  type MovieChoiceAccess,
  type MovieProtectionAccess,
} from "#infrastructure/movie-editions/access.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import type { MovieLifecycleCommandV4 } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { captureMovieOwnerPermissionV1 } from "#infrastructure/movie-editions/lifecycle/owner-permission.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { requireMovieActionChoiceAccessV4 } from "./public-access.ts";

export function movieHttpInvocationV4(budget: PublicationAuthorityReadBudget) {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const execution = {
    observed,
    ...plexBindingFreshness({
      observed,
      expiresAtMs: observed.wall + 60_000,
      guards: [],
    }),
  };
  return { budget, execution };
}

export async function authorizeMovieActionV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: MovieLifecycleCommandV4,
  context: {
    access: MovieProtectionAccess;
    movieAccess: MovieChoiceAccess | null;
    invocation: ReturnType<typeof movieHttpInvocationV4>;
    externalIds: unknown;
  },
) {
  context.invocation.execution.assertActive();
  const action = input.command.action;
  const protective = ["keep", "pin", "unpin"].includes(action);
  const person = {
    actorId: actor.id,
    subjectUserId: actor.id,
    mediaSectionId: movieSourceSection(context.externalIds),
  };
  const subject = protective
    ? await movieChoiceSubject(tx, {
        ...person,
        purpose: "protect",
        access: context.access,
      })
    : await movieChoiceSubject(tx, {
        ...person,
        purpose: "choose",
        access: requireMovieActionChoiceAccessV4(context.movieAccess),
      });
  const owner = subject.actor.role === "owner" && !subject.actor.restricted;
  if (!owner && ["pin", "unpin", "remove", "select_release"].includes(action))
    throw new MediaError(
      "owner_required",
      "Only the owner may perform this action",
      403,
    );
  if (owner && ["remove", "restore", "select_release"].includes(action)) {
    const freshness = await captureMovieOwnerPermissionV1(tx, actor.id, {
      access: requireMovieActionChoiceAccessV4(context.movieAccess),
      invocation: context.invocation,
    });
    return { owner, freshness, request: null };
  }
  const request = await tx.mediaRequest.findUnique({
    where: {
      userId_mediaId_edition: {
        userId: actor.id,
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  if (
    !owner &&
    (request === null || !request.active || request.excluded || !request.direct)
  )
    throw new MediaError(
      "request_required",
      "An active request for this edition is required",
      403,
    );
  if (!protective) {
    if (request === null)
      throw new MediaError(
        "request_required",
        "A current edition choice is required",
        403,
      );
    const choice = await readMovieChoice(tx, {
      requestId: request.id,
      expectedScope: input.scope,
      access: requireMovieActionChoiceAccessV4(context.movieAccess),
      budget: context.invocation.budget,
    });
    if (choice.status !== "authorized")
      throw new MediaError(
        "movie_edition_choice_changed",
        "Choose the current movie edition before restoring it",
        409,
      );
    return { owner, freshness: choice.freshness, request };
  }
  return {
    owner,
    freshness: subject.freshness ?? context.invocation.execution,
    request,
  };
}

export async function applyMovieHoldV4(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: MovieLifecycleCommandV4,
  keepDays: number,
) {
  const scope = {
    userId: actor.id,
    mediaId: input.scope.mediaId,
    edition: input.scope.edition,
  };
  const action = input.command.action;
  if (action === "unpin") {
    await tx.retentionHold.deleteMany({ where: { ...scope, isPin: true } });
    return;
  }
  if (action !== "keep" && action !== "pin") return;
  const previous = await tx.retentionHold.findUnique({
    where: { userId_mediaId_edition: scope },
  });
  const until = new Date(Date.now() + keepDays * 86_400_000);
  const isPin = action === "pin" || previous?.isPin === true;
  const effective =
    previous?.until != null && previous.until > until ? previous.until : until;
  await tx.retentionHold.upsert({
    where: { userId_mediaId_edition: scope },
    create: { ...scope, isPin, until: isPin ? null : effective },
    update: { isPin, until: isPin ? null : effective },
  });
}
