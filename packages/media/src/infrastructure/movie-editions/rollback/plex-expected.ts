import { Prisma, type MediaIntent } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { MovieRollbackPlexExpectedV1Schema } from "#shared/movie-editions/rollback/plex.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import { assertMovieLegacyClaimsResolvedV3 } from "#infrastructure/recovery/legacy-claims/movie/protection.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { readPlexDefinition } from "#infrastructure/plex-binding/read.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRollbackPhysicalV1 } from "./records.ts";
import {
  captureMovieRollbackPlexHandoffExecutionV1,
  movieRollbackExecutionFreshnessV1,
  type MovieRollbackHandoffExecutionV1,
} from "./retry/handoff-execution.ts";

function assertRollbackServingTarget(
  target: MediaIntent | null,
  input: { generation: number; epoch: number },
) {
  if (
    target?.availability !== "importing" ||
    target.generation !== input.generation ||
    target.automationEpoch !== input.epoch ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null
  )
    throw new PlexBindingProtection("scope_changed");
  return target;
}

/** Physical restoration is not serving authority. Recapture the original live
 * choice/permission and exact restored bytes before and after Plex IO. */
export async function captureMovieRollbackPlexExpectedV1(
  tx: Prisma.TransactionClient,
  input: {
    source: MovieAttemptOperationV4;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
    handoff?: MovieRollbackHandoffExecutionV1;
  },
) {
  const { source, access, invocation } = input;
  invocation.execution.assertActive();
  const locked = await lockMovieCommand(tx, source.scope);
  const { media } = locked;
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${source.operationId} FOR UPDATE`;
  const parent = await readMovieRollbackPhysicalV1(
    tx,
    { mode: "automatic_failed_plex", source },
    invocation.budget,
  );
  if (parent === null) throw new PlexBindingProtection("ownership_changed");
  const handoff = await captureMovieRollbackPlexHandoffExecutionV1(tx, parent, {
    ...(input.handoff === undefined ? {} : { handoff: input.handoff }),
    invocation,
    access,
    phase: "plex",
  });
  const epoch = parent.intent.authority.recoveryEpoch;
  const target = assertRollbackServingTarget(locked.target, {
    generation: parent.intent.authority.generation,
    epoch,
  });
  if (!(await lockRuntimeAuthority(tx, epoch)))
    throw new PlexBindingProtection("scope_changed");
  await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${source.attemptId} FOR UPDATE`;
  // Admission freezes the entire source AA. This is the actual row already
  // queried in this transaction by the physical-parent reader above.
  const attempt = parent.parents.source.attempt;
  if (attempt.id !== source.attemptId)
    throw new Error("Rollback rebind lost its actual queried source attempt");
  const authorized = await movieAttemptEffectAuthorityV4(
    tx,
    attempt,
    source.scope,
    {
      access,
      invocation,
      queriedAttempt: { tx, attempt, command: parent.parents.command },
    },
  );
  if (
    authorized === null ||
    attempt.state !== "imported" ||
    attempt.coordinatorOperationId !== source.operationId ||
    identityHash(access) !== identityHash(parent.intent.access)
  )
    throw new PlexBindingProtection("ownership_changed");
  const ids = [parent.asset.id, parent.receipt.successor.id].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "assetId" FROM "AssetCoverage" WHERE "assetId" IN (${Prisma.join(ids)}) ORDER BY "assetId","mediaId",edition FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "SubtitleAsset" WHERE "assetId" IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  );
  await assertPublicationUnfenced(tx, [source.scope.mediaId], ids);
  await assertNoMediaSubtitleReplacement(tx, [source.scope.mediaId]);
  await assertMovieLegacyClaimsResolvedV3(
    tx,
    { scope: source.scope, epoch },
    invocation.budget,
  );
  if (
    await tx.recoveryHold.count({
      where: {
        mediaId: source.scope.mediaId,
        edition: source.scope.edition,
        releasedAt: null,
      },
    })
  )
    throw new PlexBindingProtection("ownership_changed");
  const asset = await snapshotMoviePublicationAssetV2(
    tx,
    source.scope,
    parent.asset.id,
    invocation.budget,
  );
  const rejected = await snapshotMoviePublicationAssetV2(
    tx,
    source.scope,
    parent.receipt.successor.id,
    invocation.budget,
  );
  if (
    identityHash(asset) !== identityHash(parent.asset) ||
    identityHash(rejected) !== identityHash(parent.receipt.successor)
  )
    throw new PlexBindingProtection("ownership_changed");
  const scope = {
    mediaId: source.scope.mediaId,
    edition: source.scope.edition,
  };
  const pointer = await readPlexPointer(tx, scope, invocation.budget);
  if (
    pointer.current !== null ||
    identityHash(pointer.expected) !==
      identityHash(parent.receipt.retiredPointer)
  )
    throw new PlexBindingProtection("binding_changed");
  const canonicalTargets = await readPlexCanonicalTargets(tx, [scope]);
  const canonical = canonicalTargets[0];
  if (
    canonical?.kind !== "movie" ||
    canonical.canonicalRootId !== source.scope.rootMediaId
  )
    throw new PlexBindingProtection("scope_changed");
  const writer = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  invocation.budget.consume(1);
  const expected = MovieRollbackPlexExpectedV1Schema.parse({
    schemaVersion: 4,
    originalItem: parent.intent.originalItem,
    recoveryEpoch: epoch,
    access: [
      {
        serverMachineId: access.serverMachineId,
        sectionId: access.movieSectionId,
        sectionType: "movie",
      },
    ],
    targets: [
      {
        scope,
        editionRootId: source.scope.rootMediaId,
        mediaVersion: media.version,
        intentVersion: target.version,
        generation: target.generation,
        automationEpoch: target.automationEpoch,
        definition: await readPlexDefinition(
          tx,
          scope,
          source.scope.rootMediaId,
        ),
        canonicalIdentityHash: canonical.canonicalIdentityHash,
        numberingHash: canonical.numberingHash,
      },
    ],
    previous: [pointer.expected],
    oldGroups: [],
    newGroups: [
      {
        assetId: asset.id,
        assetVersion: asset.version,
        checksum: asset.checksum,
        sizeBytes: asset.sizeBytes,
        canonicalPath: asset.path,
        ownershipEpoch: epoch,
        canonicalRootId: source.scope.rootMediaId,
        edition: source.scope.edition,
        coverage: [scope],
        coverageHash: identityHash([scope]),
      },
    ],
    parents: [
      {
        kind: "movie_rollback_publication_v1",
        recoveryEpoch: epoch,
        reference: parent.reference,
      },
    ],
  });
  if (
    writer.revokedAt !== null ||
    writer.recoveryEpoch !== epoch ||
    writer.observedAt.getTime() > Date.now()
  )
    throw new PlexBindingProtection("ownership_changed");
  const originalFreshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      invocation.execution.expiresAtMs,
      writer.expiresAt.getTime(),
      authorized.freshness.expiresAtMs,
    ),
    guards: [invocation.execution, authorized.freshness],
  });
  const freshness = movieRollbackExecutionFreshnessV1(
    invocation,
    originalFreshness,
    handoff,
  );
  await bindPlexTransactionDeadline(tx, freshness);
  return {
    parent,
    asset,
    expected,
    canonicalTargets,
    freshness,
    writerExpiresAtMs: writer.expiresAt.getTime(),
    identitySchemaVersion: authorized.identity.schemaVersion,
    handoff,
  };
}
