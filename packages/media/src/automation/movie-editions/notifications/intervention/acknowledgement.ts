import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieNoticeDelivery } from "#automation/movie-editions/notifications/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieInterventionNoticeV4 } from "#shared/movie-editions/intervention/v4.ts";
import { assertMovieInterventionSourceV4 } from "./source.ts";

export async function assertMovieInterventionAcknowledgement(
  tx: Prisma.TransactionClient,
  delivery: MovieNoticeDelivery,
  budget: PublicationAuthorityReadBudget,
) {
  const payload = readMovieInterventionNoticeV4(delivery.event.payload);
  if (payload !== null)
    await assertMovieInterventionSourceV4(tx, delivery, payload, budget);
}
