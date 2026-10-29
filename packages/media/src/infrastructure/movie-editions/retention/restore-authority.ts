import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { readQuarantinedPlexWatchAuthority } from "#infrastructure/plex-binding/quarantine.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  readMovieRestoreSource,
  type MovieRestoreSource,
} from "./restore-source.ts";
import { captureMovieRestoreDemand } from "./restore-demand.ts";
import { snapshotMovieRestoreAssetV1 } from "./restore-snapshot.ts";

/** All mutable consent/hold facts are captured once under their actual locks; callbacks keep this original guard. */
export async function captureMovieRestoreAuthority(
  tx: Prisma.TransactionClient,
  input: {
    context: PublicationContext;
    command: MovieOperationV4;
    source: MovieRestoreSource;
    access: MovieChoiceAccess;
  },
) {
  const { context, command, access } = input;
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  await lockMovieCommand(tx, command.scope);
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${command.operationId} FOR UPDATE`;
  const source = await readMovieRestoreSource(tx, command, invocation.budget);
  if (
    source.parent.id !== input.source.parent.id ||
    source.receiptHash !== input.source.receiptHash ||
    identityHash(source.manifest) !== identityHash(input.source.manifest)
  )
    throw new FileGuardError("restore_parent_changed");
  const epoch = source.command.recoveryEpoch;
  if (!(await lockRuntimeAuthority(tx, epoch)))
    throw new FileGuardError("runtime_protected");
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: command.mediaId,
        edition: command.scope.edition,
      },
    },
  });
  assertRestoreTarget(target, command, epoch);
  const demand = await captureMovieRestoreDemand(
    tx,
    { command, source, target, access },
    invocation,
  );
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${source.entry.assetId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "assetId" FROM "AssetCoverage" WHERE "assetId"=${source.entry.assetId} ORDER BY "mediaId",edition FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE "assetId"=${source.entry.assetId} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "RetentionDecision" WHERE id=${source.decision.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT "mediaId" FROM "RecoveryHold" WHERE "mediaId"=${command.mediaId} AND edition=${command.scope.edition} FOR SHARE`;
  await tx.$queryRaw`SELECT "mediaId" FROM "AcquisitionReservation" WHERE "mediaId"=${command.mediaId} AND edition=${command.scope.edition} FOR SHARE`;
  await assertPublicationUnfenced(
    tx,
    [command.mediaId],
    [source.entry.assetId],
  );
  await assertNoMediaSubtitleReplacement(tx, [command.mediaId]);
  await assertLegacyClaimsResolved(tx, [command.mediaId]);
  if (
    (await tx.recoveryHold.count({
      where: {
        mediaId: command.mediaId,
        edition: command.scope.edition,
        releasedAt: null,
      },
    })) ||
    (await tx.acquisitionReservation.count({
      where: { mediaId: command.mediaId, edition: command.scope.edition },
    }))
  )
    throw new FileGuardError("recovery_hold");
  const retained = await readQuarantinedPlexWatchAuthority(
    tx,
    {
      decisionId: source.decision.id,
      scope: { mediaId: command.mediaId, edition: command.scope.edition },
      assetId: source.entry.assetId,
      access: {
        serverMachineId: access.serverMachineId,
        sectionId: access.movieSectionId,
        sectionType: "movie",
      },
    },
    invocation.budget,
  );
  if (
    retained.status !== "current" ||
    !("schemaVersion" in retained.authority.quarantine)
  )
    throw new FileGuardError("reconciliation_required");
  const before = await snapshotMovieRestoreAssetV1(
    tx,
    command.scope,
    source.entry.assetId,
    invocation.budget,
  );
  const storage = await publicationAuthorityDeadline(tx, context, {
    libraryKind: "movies",
    recoveryEpoch: epoch,
  });
  const freshness = plexBindingFreshness({
    observed: context.execution.observed,
    expiresAtMs: Math.min(
      context.execution.expiresAtMs,
      storage.expiresAtMs,
      demand.expiresAtMs,
    ),
    guards: [context.execution, storage, demand],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  freshness.assertActive();
  return { source, before, freshness };
}

export function assertRestoreTarget(
  target: {
    generation: number;
    automationEpoch: number;
    editionRootId: string | null;
    desiredPresence: boolean;
    monitoring: boolean;
    intentionallyRemovedAt: Date | null;
  },
  input: MovieOperationV4,
  epoch: number,
) {
  if (
    target.generation !== input.generation ||
    target.automationEpoch !== epoch ||
    target.editionRootId !== input.scope.rootMediaId ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null
  )
    throw new FileGuardError("intent_obsolete");
}
