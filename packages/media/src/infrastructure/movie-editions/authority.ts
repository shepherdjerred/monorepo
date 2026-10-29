import type {
  Prisma,
  MediaRequest,
  MovieEditionChoice,
} from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  MovieEditionChoiceAuditSchema,
  MovieEditionBirthAuthoritySchema,
} from "#shared/movie-editions/authority.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { MovieEditionReason } from "#shared/movie-editions/fulfillment.ts";
import {
  movieChoiceSubject,
  movieSourceSection,
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "./access.ts";
import { matchesMovieDefinition, movieDefinitionRef } from "./definition.ts";
import { MovieChoiceProtection } from "./errors.ts";
import type { MovieChoiceFreshness } from "./freshness.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

function protectedChoice(reason: MovieEditionReason) {
  return { status: "protected" as const, reason };
}

/** No target creation or generation renewal. Effects hold the complete scope locks first. */
export async function readMovieChoice(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    expectedScope?: MovieEditionScope;
    access: MovieChoiceAccess;
    budget?: PublicationAuthorityReadBudget;
  },
) {
  const request = await tx.mediaRequest.findUniqueOrThrow({
    where: { id: input.requestId },
  });
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: request.mediaId },
  });
  if (media.kind !== "movie") return { status: "not_applicable" as const };
  const scope = MovieEditionScopeSchema.parse({
    rootMediaId: media.id,
    mediaId: media.id,
    edition: request.edition,
  });
  if (
    input.expectedScope !== undefined &&
    (input.expectedScope.mediaId !== scope.mediaId ||
      input.expectedScope.rootMediaId !== scope.rootMediaId ||
      input.expectedScope.edition !== scope.edition)
  )
    return protectedChoice("movie_edition_choice_changed");
  if (!request.active || request.excluded || !request.direct)
    return protectedChoice("movie_edition_choice_changed");
  if (request.movieEditionChoiceId === null)
    return protectedChoice("movie_edition_choice_required");
  const choice = await tx.movieEditionChoice.findUniqueOrThrow({
    where: { id: request.movieEditionChoiceId },
  });
  input.budget?.consume(1);
  const audit = MovieEditionChoiceAuditSchema.parse(choice.authority);
  assertChoicePointer(request, choice, media.id);
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: media.id, edition: request.edition } },
  });
  if (target.editionRootId !== media.id)
    return protectedChoice("lineage_unresolved");
  const expected = movieDefinitionRef(media.id, scope.edition);
  const definition = await tx.mediaEditionDefinition.findUniqueOrThrow({
    where: { rootMediaId_key: { rootMediaId: media.id, key: scope.edition } },
  });
  input.budget?.consume(1);
  if (
    !matchesMovieDefinition(definition, expected.definition) ||
    choice.registryVersion !== 1 ||
    choice.definitionVersion !== definition.definitionVersion
  )
    return protectedChoice("edition_definition_conflict");
  const identity = await currentChoiceIdentity(tx, {
    choice,
    audit,
    access: input.access,
    mediaSectionId: movieSourceSection(media.externalIds),
  });
  if (identity.status === "protected") return identity;
  return {
    status: "authorized" as const,
    request,
    choice,
    scope,
    target,
    definition: expected.definition,
    definitionDigest: expected.definitionDigest,
    actor: identity.actor,
    subject: identity.subject,
    freshness: identity.freshness,
  };
}

function assertChoicePointer(
  request: MediaRequest,
  choice: MovieEditionChoice,
  mediaId: string,
) {
  if (
    choice.requestId !== request.id ||
    choice.choiceRevision !== request.movieEditionChoiceRevision ||
    choice.subjectUserId !== request.userId ||
    choice.rootMediaId !== mediaId ||
    choice.edition !== request.edition
  )
    throw new Error(
      "Movie choice pointer violates its immutable request scope",
    );
}

async function currentChoiceIdentity(
  tx: Prisma.TransactionClient,
  input: {
    choice: { actorId: string; subjectUserId: string };
    audit: ReturnType<typeof MovieEditionChoiceAuditSchema.parse>;
    access: MovieChoiceAccess;
    mediaSectionId: string | undefined;
  },
) {
  const { choice, audit, access } = input;
  if (audit.serverMachineId !== access.serverMachineId)
    return protectedChoice("movie_edition_choice_changed");
  try {
    const current = await movieChoiceSubject(tx, {
      actorId: choice.actorId,
      subjectUserId: choice.subjectUserId,
      access,
      purpose: "choose",
      mediaSectionId: input.mediaSectionId,
    });
    if (
      current.mapping?.homeUserId !== audit.homeUserId ||
      current.mapping.serverAccountId !== audit.serverAccountId ||
      (audit.mode === "managed_owner") !==
        (choice.actorId !== choice.subjectUserId) ||
      current.mapping.kind !== (audit.mode === "self" ? "account" : "managed")
    )
      return protectedChoice("movie_edition_choice_changed");
    if (current.freshness === null)
      throw new Error(
        "Authorized movie acquisition has no mapping freshness guard",
      );
    current.freshness.assertActive();
    return {
      status: "authorized" as const,
      ...current,
      freshness: current.freshness,
    };
  } catch (error) {
    if (error instanceof MovieChoiceProtection)
      return protectedChoice("movie_edition_choice_changed");
    if (
      error instanceof MediaError &&
      [
        "owner_required",
        "requests_restricted",
        "plex_library_access_required",
      ].includes(error.code)
    )
      return protectedChoice("movie_edition_choice_changed");
    throw error;
  }
}

export async function captureMovieAttemptChoice(
  tx: Prisma.TransactionClient,
  input: {
    sponsorRequestId: string;
    scope: MovieEditionScope;
    access: MovieChoiceAccess;
  },
) {
  const current = await readMovieChoice(tx, {
    requestId: input.sponsorRequestId,
    expectedScope: input.scope,
    access: input.access,
  });
  if (current.status !== "authorized")
    throw new MovieChoiceProtection(
      current.status === "protected" &&
        current.reason === "movie_edition_choice_required"
        ? "movie_edition_choice_required"
        : "movie_edition_choice_changed",
    );
  if (current.scope.edition !== "default")
    throw new MovieChoiceProtection("movie_edition_choice_changed");
  const proof = MovieEditionBirthAuthoritySchema.parse({
    schemaVersion: 1,
    choiceId: current.choice.id,
    choiceRevision: current.choice.choiceRevision,
    sponsorRequestId: current.request.id,
    requestVersionAtCapture: current.request.version,
    ...current.scope,
    definitionVersion: current.definition.definitionVersion,
    definitionDigest: current.definitionDigest,
    targetGenerationAtCapture: current.target.generation,
    actorId: current.choice.actorId,
    subjectUserId: current.choice.subjectUserId,
  });
  current.freshness.assertActive();
  return {
    movieEditionChoiceId: proof.choiceId,
    movieEditionChoiceRevision: proof.choiceRevision,
    movieEditionAuthority: proof,
  };
}

export async function assertMovieAttemptChoice(
  tx: Prisma.TransactionClient,
  input: {
    attemptId: string;
    purpose: "new_acquisition_effect";
    access: MovieChoiceAccess;
  },
): Promise<MovieChoiceFreshness | null> {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  const movie = await tx.mediaItem.findFirst({
    where: { id: { in: attempt.mediaIds }, kind: "movie" },
  });
  if (movie === null) return null;
  if (attempt.movieEditionAuthority === null)
    throw new MovieChoiceProtection("movie_edition_choice_required");
  const proof = MovieEditionBirthAuthoritySchema.parse(
    attempt.movieEditionAuthority,
  );
  if (
    proof.choiceId !== attempt.movieEditionChoiceId ||
    proof.choiceRevision !== attempt.movieEditionChoiceRevision ||
    proof.sponsorRequestId !== attempt.sponsorRequestId ||
    proof.mediaId !== movie.id ||
    attempt.mediaIds.length !== 1 ||
    proof.edition !== attempt.edition
  )
    throw new Error("Movie attempt birth authority is inconsistent");
  const current = await readMovieChoice(tx, {
    requestId: proof.sponsorRequestId,
    expectedScope: proof,
    access: input.access,
  });
  if (
    current.status !== "authorized" ||
    current.scope.edition !== "default" ||
    current.choice.id !== proof.choiceId ||
    current.choice.choiceRevision !== proof.choiceRevision ||
    current.choice.actorId !== proof.actorId ||
    current.choice.subjectUserId !== proof.subjectUserId ||
    current.definitionDigest !== proof.definitionDigest
  )
    throw new MovieChoiceProtection("movie_edition_choice_changed");
  current.freshness.assertActive();
  return current.freshness;
}

export async function eligibleAcquisitionSponsors(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    access: MovieChoiceAccess;
    protocol?: "movie-v4";
    budget?: PublicationAuthorityReadBudget;
  },
) {
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      active: true,
      excluded: false,
      direct: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(input.protocol === "movie-v4" ? { take: 101 } : {}),
  });
  const sponsors: Extract<
    Awaited<ReturnType<typeof readMovieChoice>>,
    { status: "authorized" }
  >[] = [];
  if (input.scope.edition !== "default" && input.protocol !== "movie-v4")
    return sponsors;
  if (input.protocol === "movie-v4" && requests.length > 100)
    throw new MediaError(
      "movie_sponsor_limit",
      "Movie sponsor scope exceeds its evidence bound",
      409,
    );
  await lockMovieChoiceIdentities(tx, { mediaIds: [input.scope.mediaId] });
  for (const request of requests) {
    const result = await readMovieChoice(tx, {
      requestId: request.id,
      expectedScope: input.scope,
      access: input.access,
      ...(input.budget === undefined ? {} : { budget: input.budget }),
    });
    if (result.status === "authorized") sponsors.push(result);
  }
  for (const sponsor of sponsors) sponsor.freshness.assertActive();
  return sponsors;
}
