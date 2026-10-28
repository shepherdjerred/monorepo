import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieRemovalNoticeV4Schema,
  type MovieRemovalCompletionV4,
} from "#shared/movie-editions/removal-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import { readMovieChoice } from "#infrastructure/movie-editions/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { queueDelivery } from "#automation/notifications/events.ts";
import type { readMovieRemovalSourceV4 } from "./removal-source.ts";

/** Exact current personal choices supply recipients even though the physical target has been removed. */
export async function queueMovieRemovalNoticesV4(
  tx: Prisma.TransactionClient,
  input: {
    completion: MovieRemovalCompletionV4;
    source: Awaited<ReturnType<typeof readMovieRemovalSourceV4>>;
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { completion, source } = input;
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: completion.scope.mediaId,
      edition: completion.scope.edition,
      active: true,
      excluded: false,
      direct: true,
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (requests.length > 100)
    throw new Error("Movie removal recipient scope exceeds its fixed bound");
  await lockMovieChoiceIdentities(tx, { mediaIds: [completion.scope.mediaId] });
  const guards: MovieChoiceFreshness[] = [];
  for (const request of requests) {
    const choice = await readMovieChoice(tx, {
      requestId: request.id,
      expectedScope: completion.scope,
      access: input.access,
      budget,
    });
    if (choice.status !== "authorized") continue;
    const preference = await tx.notificationPreference.findUnique({
      where: { userId: request.userId },
    });
    if (preference?.removalCompleted !== true) continue;
    const payload = MovieRemovalNoticeV4Schema.parse({
      schemaVersion: 4,
      kind: "movie_removal",
      eventKind: source.eventKind,
      source: completion,
      sourceHash: source.sourceHash,
      generation: source.generation,
      recoveryEpoch: source.recoveryEpoch,
      request: {
        id: request.id,
        choiceId: choice.choice.id,
        choiceRevision: choice.choice.choiceRevision,
      },
      asset: source.asset,
    });
    const event = await tx.applicationEvent.upsert({
      where: {
        dedupeKey: `movie-removal-notice-v4:${source.sourceHash}:${request.id}:${choice.choice.id}`,
      },
      update: {},
      create: {
        dedupeKey: `movie-removal-notice-v4:${source.sourceHash}:${request.id}:${choice.choice.id}`,
        mediaId: completion.scope.mediaId,
        actorId: choice.choice.actorId,
        kind: source.eventKind,
        payload,
      },
    });
    if (
      identityHash(MovieRemovalNoticeV4Schema.parse(event.payload)) !==
      identityHash(payload)
    )
      throw new Error(
        "Movie removal notice immutable source selection changed",
      );
    for (const channel of [
      preference.emailEnabled ? "email" : null,
      preference.discordEnabled ? "discord" : null,
    ].filter((value) => value !== null)) {
      const delivery = await tx.notificationDelivery.upsert({
        where: {
          eventId_userId_channel: {
            eventId: event.id,
            userId: request.userId,
            channel,
          },
        },
        update: {},
        create: {
          eventId: event.id,
          userId: request.userId,
          channel,
          state: "pending",
          recoveryEpoch: source.recoveryEpoch,
        },
      });
      await queueDelivery(
        tx,
        delivery.id,
        request.userId,
        `notification:${delivery.id}`,
      );
    }
    choice.freshness.assertActive();
    guards.push(choice.freshness);
  }
  return guards;
}
