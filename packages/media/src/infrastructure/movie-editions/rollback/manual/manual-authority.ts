import { Prisma } from "#generated/prisma/client.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import { assertMovieLegacyClaimsResolvedV3 } from "#infrastructure/recovery/legacy-claims/movie/protection.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { captureRequestedMovieRollbackOwnerV1 } from "./manual-context.ts";
import type { readRequestedMovieRollbackCommandV1 } from "./manual-command-records.ts";
import { readRequestedMovieRollbackPlaybackV1 } from "#infrastructure/movie-editions/rollback/playback-records.ts";
import { assertMovieRollbackPendingWorkV1 } from "#infrastructure/movie-editions/rollback/pending.ts";

type Command = Awaited<ReturnType<typeof readRequestedMovieRollbackCommandV1>>;

/** The owner command, exact original pair and current actual invocation own
 * this phase. Original B's requester choice never becomes manual consent. */
export async function captureRequestedMovieRollbackFilesAuthorityV1(
  tx: Prisma.TransactionClient,
  input: {
    context: PublicationContext;
    command: Command;
    access: MovieChoiceAccess;
    intent?: MovieRollbackIntentV1;
  },
) {
  const { context, command, access, intent } = input;
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  const authority = await captureRequestedMovieRollbackOwnerV1(tx, {
    actorId: command.payload.actorId,
    scope: command.source.scope,
    access,
    invocation: { ...invocation, execution: context.execution },
    expected: command.expected,
    phase: intent === undefined ? "admission" : "physical",
  });
  const ids = [
    command.expected.predecessor.id,
    command.expected.successor.id,
  ].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT a.id FROM "LibraryAsset" a WHERE a.id IN (${Prisma.join(ids)}) ORDER BY a.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT c."assetId" FROM "AssetCoverage" c WHERE c."assetId" IN (${Prisma.join(ids)}) ORDER BY c."assetId",c."mediaId",c.edition FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT s.id FROM "SubtitleAsset" s WHERE s."assetId" IN (${Prisma.join(ids)}) ORDER BY s.id FOR UPDATE`,
  );
  await assertPublicationUnfenced(tx, [command.source.scope.mediaId], ids);
  await assertNoMediaSubtitleReplacement(tx, [command.source.scope.mediaId]);
  await assertMovieLegacyClaimsResolvedV3(
    tx,
    { scope: command.source.scope, epoch: command.expected.recoveryEpoch },
    invocation.budget,
  );
  if (
    await tx.recoveryHold.count({
      where: {
        mediaId: command.source.scope.mediaId,
        edition: command.source.scope.edition,
        releasedAt: null,
      },
    })
  )
    throw new FileGuardError("movie_rollback_dependencies_active");
  await assertMovieRollbackPendingWorkV1(
    tx,
    {
      assetIds: ids,
      scope: command.source.scope,
      epoch: command.expected.recoveryEpoch,
    },
    invocation.budget,
  );
  const reservation = await tx.acquisitionReservation.findUnique({
    where: {
      mediaId_edition: {
        mediaId: command.source.scope.mediaId,
        edition: command.source.scope.edition,
      },
    },
  });
  invocation.budget.consume(reservation === null ? 0 : 1);
  if (reservation !== null)
    throw new FileGuardError("movie_rollback_dependencies_active");
  const playback = await readRequestedMovieRollbackPlaybackV1(
    tx,
    command,
    invocation.budget,
  );
  if (intent !== undefined) {
    const cleanup = await tx.upgradeCleanup.findUniqueOrThrow({
      where: { id: command.expected.cleanup.id },
    });
    invocation.budget.consume(1);
    assertAdmittedCleanup(command, intent, cleanup);
  }
  const expectedPhase = intent === undefined ? "admission" : "physical";
  if (
    playback.guard.phase !== expectedPhase ||
    (intent !== undefined &&
      (playback.guard.admission?.intentId !== intent.id ||
        playback.guard.admission.intentHash !== identityHash(intent)))
  )
    throw new FileGuardError("movie_rollback_playback_observation_required");
  if (authority.target.profileId === null)
    throw new FileGuardError("movie_rollback_profile_changed");
  await tx.$queryRaw`SELECT p.id FROM "QualityProfile" p WHERE p.id=${authority.target.profileId} FOR SHARE`;
  const profile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: authority.target.profileId },
  });
  invocation.budget.consume(1);
  if (
    intent !== undefined &&
    (intent.authority.profileId !== profile.id ||
      intent.authority.profileVersion !== profile.version ||
      identityHash(intent.access) !== identityHash(access))
  )
    throw new FileGuardError("movie_rollback_profile_changed");
  const storage = await publicationAuthorityDeadline(tx, context, {
    libraryKind: "movies",
    recoveryEpoch: authority.runtime.recoveryEpoch,
  });
  const observation = plexBindingFreshness({
    observed: context.execution.observed,
    expiresAtMs: Date.parse(playback.guard.expiresAt),
    guards: [context.execution],
  });
  const freshness = plexBindingFreshness({
    observed: context.execution.observed,
    expiresAtMs: Math.min(
      storage.expiresAtMs,
      authority.freshness.expiresAtMs,
      observation.expiresAtMs,
    ),
    guards: [context.execution, storage, authority.freshness, observation],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  return {
    authority,
    profile: { profileId: profile.id, profileVersion: profile.version },
    playback,
    freshness,
  };
}

function assertAdmittedCleanup(
  command: Command,
  intent: MovieRollbackIntentV1,
  cleanup: {
    state: string;
    version: number;
    expiresAt: Date;
    assetId: string;
    successorAssetId: string;
  },
) {
  if (
    cleanup.state !== "cancelled" ||
    cleanup.version !== command.expected.cleanup.version + 1 ||
    cleanup.expiresAt.toISOString() !== command.expected.cleanup.expiresAt ||
    cleanup.assetId !== command.expected.predecessor.id ||
    cleanup.successorAssetId !== command.expected.successor.id ||
    identityHash(intent.cleanup) !== identityHash(command.expected.cleanup)
  )
    throw new FileGuardError("movie_rollback_cleanup_changed");
}
