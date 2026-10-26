import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { MovieEditionBirthAuthoritySchema } from "#shared/movie-editions/authority.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";

type Input = {
  scope: MovieEditionScope;
  sponsorRequestId: string;
  epoch: number;
  access: MovieChoiceAccess;
};

/** Caller holds canonical/target/request/runtime locks before acquiring choice identity locks. */
export async function captureMovieChoiceV4(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  const scope = MovieEditionScopeSchema.parse(input.scope);
  const current = await readMovieChoice(tx, {
    requestId: input.sponsorRequestId,
    expectedScope: scope,
    access: input.access,
  });
  if (current.status !== "authorized")
    throw new MovieChoiceProtection(
      current.status === "protected" &&
        current.reason === "movie_edition_choice_required"
        ? "movie_edition_choice_required"
        : "movie_edition_choice_changed",
    );
  if (
    input.epoch < 0 ||
    current.target.automationEpoch !== input.epoch ||
    !current.target.desiredPresence ||
    !current.target.monitoring
  )
    throw new MediaError(
      "intent_ownership_unconfirmed",
      "Movie target does not authorize acquisition in this recovery epoch",
      409,
    );
  const proof = MovieEditionBirthAuthoritySchema.parse({
    schemaVersion: 1,
    choiceId: current.choice.id,
    choiceRevision: current.choice.choiceRevision,
    sponsorRequestId: current.request.id,
    requestVersionAtCapture: current.request.version,
    ...scope,
    definitionVersion: current.definition.definitionVersion,
    definitionDigest: current.definitionDigest,
    targetGenerationAtCapture: current.target.generation,
    actorId: current.choice.actorId,
    subjectUserId: current.choice.subjectUserId,
  });
  current.freshness.assertActive();
  return { proof, request: current.request, freshness: current.freshness };
}

/** Exact immutable birth, then the same current semantic choice; another edition cannot substitute. */
export async function assertMovieChoiceV4(
  tx: Prisma.TransactionClient,
  input: {
    attemptId: string;
    scope: MovieEditionScope;
    epoch: number;
    access: MovieChoiceAccess;
  },
) {
  const scope = MovieEditionScopeSchema.parse(input.scope);
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  const proof = MovieEditionBirthAuthoritySchema.parse(
    attempt.movieEditionAuthority,
  );
  if (
    attempt.movieEditionChoiceId !== proof.choiceId ||
    attempt.movieEditionChoiceRevision !== proof.choiceRevision ||
    attempt.sponsorRequestId !== proof.sponsorRequestId ||
    attempt.edition !== scope.edition ||
    attempt.mediaIds.length !== 1 ||
    attempt.mediaIds[0] !== scope.mediaId ||
    attempt.recoveryEpoch !== input.epoch ||
    proof.rootMediaId !== scope.rootMediaId ||
    proof.mediaId !== scope.mediaId ||
    proof.edition !== scope.edition
  )
    throw new Error(
      "Movie v4 attempt birth does not match its immutable edition scope",
    );
  const current = await captureMovieChoiceV4(tx, {
    ...input,
    sponsorRequestId: proof.sponsorRequestId,
  });
  // Same-choice retries may renew generation and request version; original birth remains literal.
  const semantic = (value: typeof proof) => ({
    choiceId: value.choiceId,
    choiceRevision: value.choiceRevision,
    rootMediaId: value.rootMediaId,
    mediaId: value.mediaId,
    edition: value.edition,
    definitionVersion: value.definitionVersion,
    definitionDigest: value.definitionDigest,
    actorId: value.actorId,
    subjectUserId: value.subjectUserId,
  });
  if (identityHash(semantic(proof)) !== identityHash(semantic(current.proof)))
    throw new MovieChoiceProtection("movie_edition_choice_changed");
  current.freshness.assertActive();
  return current.freshness;
}
