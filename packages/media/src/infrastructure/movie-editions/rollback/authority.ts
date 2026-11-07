import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import { assertMovieLegacyClaimsResolvedV3 } from "#infrastructure/recovery/legacy-claims/movie/protection.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertMovieRollbackPendingWorkV1 } from "./pending.ts";

/** Capture current scope once under all held locks. The callback keeps these
 * actual guards; it cannot acquire a fresh deadline or a new read allowance. */
export async function captureAutomaticMovieRollbackAuthorityV1(
  tx: Prisma.TransactionClient,
  input: {
    context: PublicationContext;
    source: MovieAttemptOperationV4;
    access: MovieChoiceAccess;
    assetIds: readonly [string, string];
    birthEpoch: number;
    intent?: MovieRollbackIntentV1;
  },
) {
  const { context, source, access } = input;
  const invocation = context.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  const budget = invocation.budget;
  await lockMovieCommand(tx, source.scope);
  if (!(await lockRuntimeAuthority(tx, input.birthEpoch)))
    throw new FileGuardError("runtime_protected");
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${source.operationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${source.attemptId} FOR UPDATE`;
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: source.attemptId },
  });
  budget.consume(1);
  if (
    attempt.coordinatorOperationId !== source.operationId ||
    attempt.state !== "imported" ||
    attempt.recoveryEpoch !== input.birthEpoch
  )
    throw new FileGuardError("movie_rollback_source_obsolete");
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join([...input.assetIds].sort())}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join([...input.assetIds].sort())}) ORDER BY "assetId","mediaId",edition FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "SubtitleAsset" WHERE "assetId" IN (${Prisma.join([...input.assetIds].sort())}) ORDER BY id FOR UPDATE`,
  );
  await assertPublicationUnfenced(
    tx,
    [source.scope.mediaId],
    [...input.assetIds],
  );
  await assertNoMediaSubtitleReplacement(tx, [source.scope.mediaId]);
  await assertMovieLegacyClaimsResolvedV3(
    tx,
    { scope: source.scope, epoch: attempt.recoveryEpoch },
    budget,
  );
  const holds = await tx.recoveryHold.count({
    where: {
      mediaId: source.scope.mediaId,
      edition: source.scope.edition,
      releasedAt: null,
    },
  });
  if (holds > 0) throw new FileGuardError("movie_rollback_dependencies_active");
  await assertMovieRollbackPendingWorkV1(
    tx,
    {
      assetIds: input.assetIds,
      scope: source.scope,
      epoch: input.birthEpoch,
    },
    budget,
  );
  const authority = await movieAttemptEffectAuthorityV4(
    tx,
    attempt,
    source.scope,
    { access, invocation },
  );
  if (authority === null)
    throw new FileGuardError("movie_rollback_source_obsolete");
  const predecessor = await snapshotMoviePublicationAssetV2(
    tx,
    source.scope,
    input.assetIds[0],
    budget,
  );
  const successor = await snapshotMoviePublicationAssetV2(
    tx,
    source.scope,
    input.assetIds[1],
    budget,
  );
  if (
    predecessor.state !== "superseded" ||
    successor.state !== "published" ||
    predecessor.supersededByAssetId !== successor.id ||
    predecessor.coverage[0].current ||
    !successor.coverage[0].current ||
    predecessor.ownershipEpoch !== attempt.recoveryEpoch ||
    successor.ownershipEpoch !== attempt.recoveryEpoch ||
    (input.intent !== undefined &&
      (identityHash(predecessor) !== identityHash(input.intent.predecessor) ||
        identityHash(successor) !== identityHash(input.intent.successor)))
  )
    throw new FileGuardError("movie_rollback_pair_changed");
  const sidecars = [
    ...successor.subtitles,
    ...successor.subtitleHistory,
  ].filter(
    (caption) => caption.storageKind !== "embedded" && caption.path !== null,
  );
  if (sidecars.length > 0)
    throw new FileGuardError("movie_rollback_successor_sidecar_unsettled");
  const profile = z
    .object({ profileId: z.uuid(), profileVersion: z.int().nonnegative() })
    .parse(attempt.failure);
  const storage = await publicationAuthorityDeadline(tx, context, {
    libraryKind: "movies",
    recoveryEpoch: attempt.recoveryEpoch,
  });
  const freshness = plexBindingFreshness({
    observed: context.execution.observed,
    expiresAtMs: Math.min(
      context.execution.expiresAtMs,
      storage.expiresAtMs,
      authority.freshness.expiresAtMs,
    ),
    guards: [context.execution, storage, authority.freshness],
  });
  await bindPlexTransactionDeadline(tx, freshness);
  return { attempt, authority, predecessor, successor, profile, freshness };
}
