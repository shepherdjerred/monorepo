import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { assertAcquisition } from "#automation/files/guards.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import {
  assertSeriesPackStagingAttemptCurrentV1,
  assertSeriesPackStagingObservationCurrentV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/observation.ts";
import type { SeriesPackStagingScopeV1 } from "#shared/acquisition/series-pack-staging-v1.ts";

export async function assertSeriesPackStagingScopeCurrentV1(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  scope: SeriesPackStagingScopeV1,
) {
  if (attempt.torrentId === null) throw new FileGuardError("torrent_missing");
  await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${attempt.torrentId} FOR SHARE`;
  const torrent = await tx.torrent.findUniqueOrThrow({
    where: { id: attempt.torrentId },
  });
  if (!torrent.owned)
    throw new FileGuardError("series_pack_staging_scope_changed");
  assertSeriesPackStagingAttemptCurrentV1(attempt, scope);
  assertSeriesPackStagingObservationCurrentV1(scope, torrent.observation);
  return torrent;
}

/** Native work remains outside PG; every separate write reacquires complete current authority. */
export async function authorizeSeriesPackStagingV1(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  scope: SeriesPackStagingScopeV1,
) {
  assertPublicationActive(context);
  await lockAcquisitionMedia(tx, scope.coverage);
  if (!(await context.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  await assertAcquisition(tx, scope.attemptId, {
    serverMachineId: context.serverMachineId,
    libraryManagement: context.libraryManagement,
  });
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: scope.attemptId },
  });
  const torrent = await assertSeriesPackStagingScopeCurrentV1(
    tx,
    attempt,
    scope,
  );
  const deadline = await publicationAuthorityDeadline(tx, context, {
    libraryKind: "tv",
    recoveryEpoch: attempt.recoveryEpoch,
  });
  await bindPlexTransactionDeadline(tx, deadline);
  assertPublicationActive(context);
  return { attempt, torrent, deadline };
}
