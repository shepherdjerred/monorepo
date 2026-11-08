import type {
  AcquisitionAttempt,
  MovieEditionChoice,
  Operation,
  Prisma,
} from "#generated/prisma/client.ts";
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
  queriedAttempt?: QueriedMovieAttemptV4;
};

/** Actual rows already queried by the caller in this transaction. This locator
 * skips duplicate reads only; all birth and current authority checks still run. */
export type QueriedMovieAttemptV4 = {
  tx: object;
  attempt: AcquisitionAttempt;
  command?: Operation;
  choice?: MovieEditionChoice;
};

export function movieAttemptQueriedInTransactionV4(
  tx: object,
  attemptId: string,
  queried?: QueriedMovieAttemptV4,
) {
  if (queried === undefined) return;
  if (queried.tx !== tx || queried.attempt.id !== attemptId)
    throw new Error(
      "Queried movie attempt changed its actual transaction or identity",
    );
  return queried.attempt;
}

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
  const captured = await readMovieAttemptSponsorRowsV4(tx, input);
  return captured === null ? null : captured.authority;
}

export async function readMovieAttemptSponsorRowsV4(
  tx: Prisma.TransactionClient,
  input: SponsorInput,
) {
  const attempt = await readSourceAttempt(tx, input);
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
  const choice = await readSourceChoice(tx, input, proof.choiceId);
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
    authority: {
      userId: choice.subjectUserId,
      actorId: choice.actorId,
      serverMachineId: audit.serverMachineId,
    },
    choice,
  };
}

async function readSourceChoice(
  tx: Prisma.TransactionClient,
  input: SponsorInput,
  choiceId: string,
) {
  const queried = input.queriedAttempt?.choice;
  if (queried !== undefined) {
    if (queried.id !== choiceId)
      throw new Error("Queried movie birth choice changed its exact identity");
    return queried;
  }
  const choice = await tx.movieEditionChoice.findUniqueOrThrow({
    where: { id: choiceId },
  });
  input.budget?.consume(1);
  return choice;
}

async function readSourceAttempt(
  tx: Prisma.TransactionClient,
  input: SponsorInput,
) {
  const queried = movieAttemptQueriedInTransactionV4(
    tx,
    input.attemptId,
    input.queriedAttempt,
  );
  if (queried !== undefined) return queried;
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  input.budget?.consume(1);
  return attempt;
}
