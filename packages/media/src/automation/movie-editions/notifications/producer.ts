import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { MoviePublicationNoticeV4Schema } from "#shared/movie-editions/notifications-v4.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { queueDelivery } from "#automation/notifications/events.ts";
import { readMovieNoticeSource } from "./source.ts";

/** Caller holds the exact movie/request scope and retains every returned guard through commit. */
export async function queueMoviePublicationNoticesV4(
  tx: Prisma.TransactionClient,
  input: { input: MovieAttemptOperationV4; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const source = await readMovieNoticeSource(tx, input.input, budget);
  const group = source.group;
  budget.consume(2);
  const binding = await readCurrentPlexBinding(tx, {
    scope: {
      mediaId: input.input.scope.mediaId,
      edition: input.input.scope.edition,
    },
    assetId: group.assetId,
    access: {
      serverMachineId: input.access.serverMachineId,
      sectionId: input.access.movieSectionId,
      sectionType: "movie",
    },
  });
  if (binding.status !== "current")
    throw new PlexBindingProtection(binding.reason);
  if (identityHash(binding.association.group) !== identityHash(group))
    throw new PlexBindingProtection("binding_changed");
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope: input.input.scope,
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
      (source.eventKind === "media_upgraded" && !preference.upgrades)
    )
      continue;
    const payload = MoviePublicationNoticeV4Schema.parse({
      schemaVersion: 4,
      kind: "movie_publication",
      eventKind: source.eventKind,
      source: input.input,
      publicationHash: source.publicationHash,
      generation: sponsor.target.generation,
      recoveryEpoch: group.ownershipEpoch,
      request: {
        id: sponsor.request.id,
        choiceId: sponsor.choice.id,
        choiceRevision: sponsor.choice.choiceRevision,
      },
      asset: {
        id: group.assetId,
        version: group.assetVersion,
        checksum: group.checksum,
      },
    });
    const key = `movie-notice-v4:${input.input.attemptId}:${source.eventKind}:${sponsor.request.id}:${String(sponsor.choice.choiceRevision)}:${String(sponsor.target.generation)}`;
    const event = await tx.applicationEvent.upsert({
      where: { dedupeKey: key },
      update: {},
      create: {
        dedupeKey: key,
        mediaId: input.input.scope.mediaId,
        actorId: sponsor.choice.actorId,
        kind: source.eventKind,
        payload,
      },
    });
    if (identityHash(event.payload) !== identityHash(payload))
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
          recoveryEpoch: group.ownershipEpoch,
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
