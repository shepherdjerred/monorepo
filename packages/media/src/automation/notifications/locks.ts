import type { Prisma } from "#generated/prisma/client.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { deliveryInclude, eventMediaIds } from "./message.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import {
  lockBoundCohortRows,
  type BoundMediaCohort,
} from "#automation/retention/binding.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

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
  await lockDefaultScopes(
    tx,
    mediaIds.map((mediaId) => defaultScope(mediaId)),
    {
      createMissing: false,
    },
  );
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

export async function deliveryRuntimeActive(
  tx: Prisma.TransactionClient,
  epoch: number,
): Promise<boolean> {
  return await lockRuntimeAuthority(tx, epoch);
}
