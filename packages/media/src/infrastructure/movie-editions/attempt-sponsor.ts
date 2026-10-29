import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieEditionBirthAuthoritySchema,
  MovieEditionChoiceAuditSchema,
  type MovieEditionBirthAuthority,
} from "#shared/movie-editions/authority.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type SponsorInput = {
  attemptId: string;
  expectedScope?: MovieEditionScope | undefined;
  expectedRequestId?: string | undefined;
  budget?: PublicationAuthorityReadBudget | undefined;
};

function assertExpectedSponsor(
  input: SponsorInput,
  proof: MovieEditionBirthAuthority,
) {
  if (
    input.expectedRequestId !== undefined &&
    input.expectedRequestId !== proof.sponsorRequestId
  )
    throw new Error("Recorded movie sponsor belongs to another request");
  const scope = input.expectedScope;
  if (
    scope !== undefined &&
    (scope.rootMediaId !== proof.rootMediaId ||
      scope.mediaId !== proof.mediaId ||
      scope.edition !== proof.edition)
  )
    throw new Error("Recorded movie sponsor belongs to another edition scope");
}

/** Immutable attribution for exact recorded-effect observation. Never fresh choice authority. */
export async function readMovieAttemptSponsor(
  tx: Prisma.TransactionClient,
  input: SponsorInput,
) {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  input.budget?.consume(1);
  if (attempt.movieEditionAuthority === null) {
    if (
      attempt.movieEditionChoiceId !== null ||
      attempt.movieEditionChoiceRevision !== null
    )
      throw new Error("Partial movie attempt authority");
    return null;
  }
  const proof = MovieEditionBirthAuthoritySchema.parse(
    attempt.movieEditionAuthority,
  );
  assertExpectedSponsor(input, proof);
  const choice = await tx.movieEditionChoice.findUniqueOrThrow({
    where: { id: proof.choiceId },
  });
  input.budget?.consume(1);
  const audit = MovieEditionChoiceAuditSchema.parse(choice.authority);
  if (
    attempt.movieEditionChoiceId !== choice.id ||
    attempt.movieEditionChoiceRevision !== choice.choiceRevision ||
    proof.choiceRevision !== choice.choiceRevision ||
    proof.sponsorRequestId !== choice.requestId ||
    proof.sponsorRequestId !== attempt.sponsorRequestId ||
    attempt.edition !== proof.edition ||
    choice.edition !== proof.edition ||
    choice.rootMediaId !== proof.rootMediaId ||
    choice.definitionVersion !== proof.definitionVersion ||
    choice.actorId !== proof.actorId ||
    choice.subjectUserId !== proof.subjectUserId ||
    attempt.mediaIds.length !== 1 ||
    attempt.mediaIds[0] !== proof.mediaId ||
    choice.createdAt.getTime() > attempt.createdAt.getTime()
  )
    throw new Error("Immutable movie attempt attribution changed");
  return {
    userId: choice.subjectUserId,
    actorId: choice.actorId,
    serverMachineId: audit.serverMachineId,
  };
}
