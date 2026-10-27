import type { Prisma } from "#generated/prisma/client.ts";
import {
  readMovieNoticeV4,
  movieNoticeSourceHash,
} from "#shared/movie-editions/notifications-v4.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieNoticeDelivery } from "./authority.ts";
import { readMovieNoticeProof } from "./source.ts";

/** Receipt reconciliation never authorizes another send or depends on current recipient consent/configuration. */
export async function assertMovieNoticeAcknowledgement(
  tx: Prisma.TransactionClient,
  delivery: MovieNoticeDelivery,
) {
  const payload = readMovieNoticeV4(delivery.event.payload);
  if (payload === null) return;
  const budget = new PublicationAuthorityReadBudget();
  const source = await readMovieNoticeProof(tx, payload, budget);
  const choice = await tx.movieEditionChoice.findUniqueOrThrow({
    where: { id: payload.request.choiceId },
  });
  budget.consume(1);
  if (
    source.publicationHash !== movieNoticeSourceHash(payload) ||
    source.eventKind !== payload.eventKind ||
    delivery.event.kind !== payload.eventKind ||
    delivery.event.mediaId !== payload.source.scope.mediaId ||
    source.group.ownershipEpoch !== payload.recoveryEpoch ||
    delivery.recoveryEpoch !== payload.recoveryEpoch ||
    source.group.assetId !== payload.asset.id ||
    source.group.assetVersion !== payload.asset.version ||
    source.group.checksum !== payload.asset.checksum ||
    choice.requestId !== payload.request.id ||
    choice.choiceRevision !== payload.request.choiceRevision ||
    choice.subjectUserId !== delivery.userId ||
    choice.rootMediaId !== payload.source.scope.rootMediaId ||
    choice.edition !== payload.source.scope.edition ||
    choice.actorId !== delivery.event.actorId
  )
    throw new Error(
      "Movie notification acknowledgement lost its original publication or recipient choice",
    );
}
