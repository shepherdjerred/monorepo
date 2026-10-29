import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieNoticeV4Schema,
  type MovieCaptionNoticeV4,
  type MoviePublicationNoticeV4,
  type MovieRestorationNoticeV4,
  type MovieNoticeV4,
} from "#shared/movie-editions/notifications-v4.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { queueDelivery } from "#automation/notifications/events.ts";

type Draft =
  | Omit<MoviePublicationNoticeV4, "request" | "generation">
  | Omit<MovieRestorationNoticeV4, "request" | "generation">
  | Omit<MovieCaptionNoticeV4, "request" | "generation">;

/** Classification and household policy do not create personal notification consent. */
export async function queueMovieNoticesV4(
  tx: Prisma.TransactionClient,
  input: { draft: Draft; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const { draft } = input;
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope: draft.source.scope,
    access: input.access,
    protocol: "movie-v4",
    budget,
  });
  const guards: MovieChoiceFreshness[] = [];
  let queued = 0;
  for (const sponsor of sponsors) {
    const preference = await tx.notificationPreference.findUnique({
      where: { userId: sponsor.request.userId },
    });
    if (
      preference === null ||
      (draft.eventKind === "media_upgraded" && !preference.upgrades)
    )
      continue;
    const payload = MovieNoticeV4Schema.parse({
      ...draft,
      generation: sponsor.target.generation,
      request: {
        id: sponsor.request.id,
        choiceId: sponsor.choice.id,
        choiceRevision: sponsor.choice.choiceRevision,
      },
    });
    const sourceKey = noticeSourceKey(draft);
    const key = `movie-notice-v4:${sourceKey}:${draft.eventKind}:${sponsor.request.id}:${String(sponsor.choice.choiceRevision)}:${String(sponsor.target.generation)}`;
    const event = await tx.applicationEvent.upsert({
      where: { dedupeKey: key },
      update: {},
      create: {
        dedupeKey: key,
        mediaId: draft.source.scope.mediaId,
        actorId: sponsor.choice.actorId,
        kind: draft.eventKind,
        payload,
      },
    });
    if (
      identityHash(
        noticeSelection(MovieNoticeV4Schema.parse(event.payload)),
      ) !== identityHash(noticeSelection(payload))
    )
      throw new Error("Movie notification immutable source selection changed");
    for (const channel of [
      preference.emailEnabled ? "email" : null,
      preference.discordEnabled ? "discord" : null,
    ].filter((value) => value !== null)) {
      const delivery = await tx.notificationDelivery.upsert({
        where: {
          eventId_userId_channel: {
            eventId: event.id,
            userId: sponsor.request.userId,
            channel,
          },
        },
        update: {},
        create: {
          eventId: event.id,
          userId: sponsor.request.userId,
          channel,
          state: "pending",
          recoveryEpoch: draft.recoveryEpoch,
        },
      });
      await queueDelivery(
        tx,
        delivery.id,
        sponsor.request.userId,
        `notification:${delivery.id}`,
      );
      queued++;
    }
    sponsor.freshness.assertActive();
    guards.push(sponsor.freshness);
  }
  for (const guard of guards) guard.assertActive();
  return { queued, guards };
}

/** A readiness cohort keeps its first real caption receipt when another accepted caption arrives. */
function noticeSelection(payload: MovieNoticeV4) {
  if (payload.kind !== "movie_subtitles") return payload;
  const {
    captionHash: _hash,
    source: { operationId: _operationId, subtitleId: _subtitleId, ...source },
    ...notice
  } = payload;
  return { ...notice, source };
}

function noticeSourceKey(draft: Draft) {
  if (draft.kind === "movie_publication") return draft.source.attemptId;
  return draft.kind === "movie_restoration"
    ? `restore:${draft.source.operationId}`
    : `captions:${draft.source.assetId}:${draft.targetAuthority}`;
}
