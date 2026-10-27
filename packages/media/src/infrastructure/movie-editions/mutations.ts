import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type {
  CancelMovieRequestV3,
  RevokeMovieEditionChoiceV3,
} from "#shared/movie-editions/commands.ts";
import { invalidateRetention } from "#infrastructure/action-guards.ts";
import { movieChoiceSubject, type MovieProtectionAccess } from "./access.ts";
import { lockMovieCommand, movieCommandConflict } from "./locks.ts";
import { releaseCancelledMovieReservationV4 } from "./lifecycle/cancellation.ts";
import { personalRequestGenerationChange } from "#infrastructure/library-monitoring/intent.ts";

export async function removeMovieChoice(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: CancelMovieRequestV3 | RevokeMovieEditionChoiceV3,
  access: MovieProtectionAccess,
) {
  const { target } = await lockMovieCommand(tx, input.scope);
  const request = await tx.mediaRequest.findUniqueOrThrow({
    where: { id: input.requestId },
  });
  if (
    target?.version !== input.expected.targetVersion ||
    request.version !== input.expected.requestVersion ||
    request.movieEditionChoiceRevision !== input.expected.choiceRevision ||
    request.userId !== input.subjectUserId ||
    request.mediaId !== input.scope.mediaId ||
    request.edition !== input.scope.edition ||
    !request.active ||
    request.excluded
  )
    throw movieCommandConflict();
  const current = await movieChoiceSubject(tx, {
    actorId: actor.id,
    subjectUserId: request.userId,
    access,
    purpose: "protect",
  });
  const cancel = input.action === "cancel_request";
  const updated = await tx.mediaRequest.update({
    where: { id: request.id },
    data: {
      movieEditionChoiceId: null,
      movieEditionChoiceRevision: { increment: 1 },
      version: { increment: 1 },
      ...(cancel ? { active: false, excluded: true, direct: false } : {}),
    },
  });
  const remaining = await tx.mediaRequest.count({
    where: {
      mediaId: request.mediaId,
      edition: request.edition,
      active: true,
      excluded: false,
      direct: true,
    },
  });
  const intent = await tx.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: request.mediaId, edition: request.edition },
    },
    data: {
      ...personalRequestGenerationChange(target),
      version: { increment: 1 },
      ...(remaining === 0 ? { monitoring: target.libraryMonitoring } : {}),
    },
  });
  await releaseCancelledMovieReservationV4(tx, input.scope, request.id);
  await tx.mediaItem.update({
    where: { id: request.mediaId },
    data: { version: { increment: 1 } },
  });
  if (request.edition === "default")
    await invalidateRetention(tx, request.mediaId);
  await tx.applicationEvent.create({
    data: {
      mediaId: request.mediaId,
      actorId: current.actor.id,
      kind: cancel ? "movie_request_cancelled" : "movie_edition_choice_revoked",
      payload: {
        requestId: request.id,
        subjectUserId: current.subject.id,
        edition: request.edition,
        choiceRevision: updated.movieEditionChoiceRevision,
      },
    },
  });
  current.freshness?.assertActive();
  return { request: updated, intent, freshness: current.freshness };
}
