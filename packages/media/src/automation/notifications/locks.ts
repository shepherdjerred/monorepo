import type { Prisma } from "#generated/prisma/client.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { deliveryInclude, eventMediaIds } from "./message.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import {
  lockBoundCohortRows,
  type BoundMediaCohort,
} from "#automation/retention/binding.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { readMovieNoticeV4 } from "#shared/movie-editions/notifications-v4.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { readMovieRetentionWarningV4 } from "#shared/movie-editions/retention-v4.ts";
import { readMovieRemovalNoticeV4 } from "#shared/movie-editions/removal-v4.ts";
import { readMovieInterventionNoticeV4 } from "#shared/movie-editions/intervention/v4.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";

/** Match Keep/unwatch and root-cancellation ordering before locking delivery authority. */
export async function lockDelivery(
  tx: Prisma.TransactionClient,
  id: string,
  binding?: { cohort: BoundMediaCohort; freshness: PlexBindingFreshness },
) {
  const snapshot = await tx.notificationDelivery.findUniqueOrThrow({
    where: { id },
    include: deliveryInclude,
  });
  const mediaIds = [
    ...new Set([
      ...eventMediaIds(snapshot),
      ...(binding?.cohort.mediaIds ?? []),
    ]),
  ].sort();
  const movieNotice = readMovieNoticeV4(snapshot.event.payload);
  const movieWarning = readMovieRetentionWarningV4(snapshot.event.payload);
  const movieRemoval = readMovieRemovalNoticeV4(snapshot.event.payload);
  const movieIntervention = readMovieInterventionNoticeV4(
    snapshot.event.payload,
  );
  const interest =
    snapshot.event.kind === "interest_check"
      ? InterestCheckNoticeSchema.parse(snapshot.event.payload)
      : null;
  const interestMedia =
    interest === null
      ? null
      : await tx.mediaItem.findUnique({
          where: { id: interest.mediaId },
          select: { kind: true },
        });
  const movieScope =
    movieNotice?.source.scope ??
    movieWarning?.scope ??
    movieRemoval?.source.scope ??
    movieIntervention?.source.scope ??
    (interest !== null && interestMedia?.kind === "movie"
      ? {
          mediaId: interest.mediaId,
          rootMediaId: interest.mediaId,
          edition: interest.edition,
        }
      : undefined);
  if (movieScope === undefined)
    await lockDefaultScopes(
      tx,
      mediaIds.map((mediaId) => defaultScope(mediaId)),
      { createMissing: false },
    );
  else {
    if (snapshot.event.mediaId !== movieScope.mediaId)
      throw new Error("Movie notification locks require the exact event scope");
    await lockMovieCommand(tx, movieScope);
  }
  await lockEffectiveRequests(tx, mediaIds);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "LegacyWriterLease" WHERE id = 'singleton' FOR SHARE`;
  if (snapshot.event.kind === "subtitles_ready") await lockSubtitlePolicies(tx);
  await lockMovieChoiceIdentities(tx, {
    mediaIds,
    extraUserIds: [snapshot.userId],
  });
  if (binding !== undefined) {
    await lockBoundCohortRows(tx, binding.cohort, binding.freshness);
    await bindPlexTransactionDeadline(tx, binding.freshness);
  }
  await tx.$queryRaw`SELECT "userId" FROM "NotificationPreference" WHERE "userId" = ${snapshot.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE id = ${id} FOR UPDATE`;
  return await tx.notificationDelivery.findUniqueOrThrow({
    where: { id },
    include: deliveryInclude,
  });
}
