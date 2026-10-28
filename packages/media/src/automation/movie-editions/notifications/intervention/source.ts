import { z } from "zod";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import type { MovieInterventionNoticeV4 } from "#shared/movie-editions/intervention/v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { Delivery } from "#automation/notifications/recipient.ts";

export function movieInterventionCommand(operation: {
  id: string;
  kind: string;
  targetId: string | null;
  payload: unknown;
}) {
  const raw = z
    .object({
      ...MovieOperationV4Schema.shape,
      kind: z.enum(["reconcile_movie_edition_v4", "acquire_movie_edition_v4"]),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const source = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(raw),
  );
  if (
    operation.id !== source.operationId ||
    operation.kind !== raw.kind ||
    operation.targetId !== source.mediaId
  )
    throw new Error("Movie intervention lost its actual scoped command");
  return {
    source,
    sourceHash: identityHash(operation.payload),
    recoveryEpoch: raw.recoveryEpoch,
  };
}

/** Historical delivery acknowledgement checks original command and recipient, before dynamic configuration. */
export async function assertMovieInterventionSourceV4(
  tx: Prisma.TransactionClient,
  delivery: Delivery,
  payload: MovieInterventionNoticeV4,
  budget: PublicationAuthorityReadBudget,
) {
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: payload.source.operationId },
  });
  budget.consume(1);
  const original = movieInterventionCommand(command);
  if (
    identityHash(original.source) !== identityHash(payload.source) ||
    original.sourceHash !== payload.sourceHash ||
    original.recoveryEpoch !== payload.recoveryEpoch ||
    delivery.recoveryEpoch !== payload.recoveryEpoch ||
    delivery.event.mediaId !== payload.source.mediaId ||
    delivery.event.kind !== payload.eventKind ||
    delivery.userId !== payload.recipient.userId
  )
    throw new Error(
      "Movie intervention notification changed its original source or recipient",
    );
  await assertInterventionAttempt(tx, command, payload, budget);
  await assertInterventionRecipient(tx, delivery, payload, budget);
}

async function assertInterventionAttempt(
  tx: Prisma.TransactionClient,
  command: Operation,
  payload: MovieInterventionNoticeV4,
  budget: PublicationAuthorityReadBudget,
) {
  if (payload.attemptId !== undefined) {
    const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: payload.attemptId },
    });
    budget.consume(1);
    if (
      attempt.operationId !== command.id &&
      attempt.coordinatorOperationId !== command.id
    ) {
      // A later genuine retry retains its original coordinator selection in that command's immutable capture.
      const selected = z
        .object({
          movieRetryV1: z
            .object({
              attemptId: z.uuid(),
              previousCoordinatorOperationId: z.uuid(),
            })
            .optional(),
        })
        .parse(command.payload);
      if (selected.movieRetryV1?.attemptId !== attempt.id)
        throw new Error(
          "Movie intervention lost its actual failed acquisition",
        );
    }
    if (
      attempt.edition !== payload.source.scope.edition ||
      attempt.mediaIds.length !== 1 ||
      attempt.mediaIds[0] !== payload.source.mediaId ||
      attempt.recoveryEpoch !== payload.recoveryEpoch
    )
      throw new Error(
        "Movie intervention acquisition changed its literal scope",
      );
  }
}

async function assertInterventionRecipient(
  tx: Prisma.TransactionClient,
  delivery: Delivery,
  payload: MovieInterventionNoticeV4,
  budget: PublicationAuthorityReadBudget,
) {
  if (payload.recipient.kind === "personal") {
    const choice = await tx.movieEditionChoice.findUniqueOrThrow({
      where: { id: payload.recipient.choiceId },
    });
    budget.consume(1);
    if (
      choice.requestId !== payload.recipient.requestId ||
      choice.choiceRevision !== payload.recipient.choiceRevision ||
      choice.subjectUserId !== delivery.userId ||
      choice.rootMediaId !== payload.source.mediaId ||
      choice.edition !== payload.source.scope.edition ||
      choice.actorId !== delivery.event.actorId
    )
      throw new Error("Movie intervention lost its original personal choice");
  } else if (delivery.event.actorId !== null)
    throw new Error(
      "Owner intervention cannot borrow personal actor attribution",
    );
}
