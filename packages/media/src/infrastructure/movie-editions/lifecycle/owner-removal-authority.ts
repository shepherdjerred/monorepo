import type { Operation, Prisma } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { readMovieOwnerLifecycleSourceV1 } from "./owner-source.ts";
import { captureMovieOwnerPermissionV1 } from "./owner-permission.ts";
import { movieOwnerRemovalConfirmationV1 } from "./owner-confirmation.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";

/** Caller retains canonical/target/request/runtime locks and then locks the physical video cohort. */
export async function captureMovieOwnerRemovalAuthorityV1(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
  operation: Operation,
  context: {
    access: MovieChoiceAccess;
    invocation: Pick<MovieManagementInvocation, "budget"> & {
      execution: Parameters<
        typeof captureMovieOwnerPermissionV1
      >[2]["invocation"]["execution"];
    };
  },
) {
  const source = readMovieOwnerLifecycleSourceV1(operation, input, "remove");
  if (source === null)
    throw new Error(
      "Owner removal authority requires its explicit durable source",
    );
  const freshness = await captureMovieOwnerPermissionV1(
    tx,
    source.actorId,
    context,
  );
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
  });
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  if (
    media.version !== source.applied.mediaVersion ||
    target.version !== source.applied.targetVersion ||
    target.editionRootId !== input.scope.rootMediaId ||
    target.generation !== input.generation ||
    target.automationEpoch !== source.applied.recoveryEpoch ||
    target.desiredPresence ||
    target.monitoring ||
    target.libraryMonitoring ||
    target.intentionallyRemovedAt === null
  )
    throw new FileGuardError("movie_owner_action_changed");
  await lockOwnerRemovalProtectionV1(tx, input);
  const activeHolds = await tx.retentionHold.count({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      OR: [{ isPin: true }, { until: { gt: new Date() } }],
    },
  });
  const recovery = await tx.recoveryHold.count({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      releasedAt: null,
    },
  });
  const reservation = await tx.acquisitionReservation.count({
    where: { mediaId: input.scope.mediaId, edition: input.scope.edition },
  });
  if (activeHolds > 0) throw new FileGuardError("retention_hold");
  if (recovery > 0) throw new FileGuardError("recovery_hold");
  if (reservation > 0) throw new FileGuardError("operation_in_progress");
  const coverage = await tx.assetCoverage.findMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      current: true,
    },
    select: { assetId: true },
    take: 2,
  });
  const assetId = coverage[0]?.assetId;
  if (assetId === undefined || coverage.length !== 1)
    throw new FileGuardError("coverage_changed");
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${assetId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "assetId" FROM "AssetCoverage" WHERE "assetId"=${assetId} ORDER BY "mediaId",edition FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE "assetId"=${assetId} ORDER BY id FOR UPDATE`;
  const snapshot = await snapshotMoviePublicationAssetV2(
    tx,
    input.scope,
    assetId,
    context.invocation.budget,
  );
  if (snapshot.ownershipEpoch !== source.applied.recoveryEpoch)
    throw new FileGuardError("ownership_changed");
  if (source.request.command.action !== "remove")
    throw new Error("Owner removal source action changed");
  if (
    identityHash(movieOwnerRemovalConfirmationV1(snapshot)) !==
    identityHash(source.request.command.confirmation)
  )
    throw new FileGuardError("movie_owner_action_changed");
  freshness.assertActive();
  return { source, snapshot, freshness };
}

async function lockOwnerRemovalProtectionV1(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
) {
  const { mediaId, edition } = input.scope;
  await tx.$queryRaw`SELECT id FROM "RetentionHold" WHERE "mediaId"=${mediaId} AND edition=${edition} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT "mediaId" FROM "RecoveryHold" WHERE "mediaId"=${mediaId} AND edition=${edition} FOR SHARE`;
  await tx.$queryRaw`SELECT "mediaId" FROM "AcquisitionReservation" WHERE "mediaId"=${mediaId} AND edition=${edition} FOR SHARE`;
}
