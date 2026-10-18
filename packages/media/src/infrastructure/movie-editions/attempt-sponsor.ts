import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieEditionBirthAuthoritySchema,
  MovieEditionChoiceAuditSchema,
} from "#shared/movie-editions/authority.ts";

/** Immutable attribution for exact recorded-effect observation. Never fresh choice authority. */
export async function readMovieAttemptSponsor(
  tx: Prisma.TransactionClient,
  input: { attemptId: string },
) {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
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
  const choice = await tx.movieEditionChoice.findUniqueOrThrow({
    where: { id: proof.choiceId },
  });
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
