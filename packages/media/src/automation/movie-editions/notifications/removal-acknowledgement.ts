import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieNoticeDelivery } from "./authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieRemovalNoticeV4 } from "#shared/movie-editions/removal-v4.ts";
import { readMovieRemovalSourceV4 } from "./removal-source.ts";
import { assertRemovalNoticeSource } from "./removal-authority.ts";

/** Provider receipt reconciliation validates historical source/recipient selection without granting another send. */
export async function assertMovieRemovalAcknowledgement(
  tx: Prisma.TransactionClient,
  delivery: MovieNoticeDelivery,
  budget: PublicationAuthorityReadBudget,
) {
  const payload = readMovieRemovalNoticeV4(delivery.event.payload);
  if (payload === null) return;
  const source = await readMovieRemovalSourceV4(tx, payload.source, budget);
  assertRemovalNoticeSource(delivery, payload, source);
  const choice = await tx.movieEditionChoice.findUniqueOrThrow({
    where: { id: payload.request.choiceId },
  });
  budget.consume(1);
  if (
    choice.requestId !== payload.request.id ||
    choice.choiceRevision !== payload.request.choiceRevision ||
    choice.subjectUserId !== delivery.userId ||
    choice.rootMediaId !== payload.source.scope.rootMediaId ||
    choice.edition !== payload.source.scope.edition ||
    choice.actorId !== delivery.event.actorId
  )
    throw new Error(
      "Movie removal acknowledgement lost its original recipient choice",
    );
}
