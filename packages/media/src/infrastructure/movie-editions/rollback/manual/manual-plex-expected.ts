import { readRuntimeProof } from "#infrastructure/handoff/runtime-proof.ts";
import { Prisma } from "#generated/prisma/client.ts";
import type { MovieRollbackOperationV1 } from "#shared/movie-editions/rollback/operation.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { MovieRollbackPlexExpectedV1Schema } from "#shared/movie-editions/rollback/plex.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertNoMediaSubtitleReplacement } from "#automation/files/guards.ts";
import { assertMovieLegacyClaimsResolvedV3 } from "#infrastructure/recovery/legacy-claims/movie/protection.ts";
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
import { readMovieRollbackPhysicalV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { readRequestedMovieRollbackCommandV1 } from "./manual-command-records.ts";
import { captureRequestedMovieRollbackOwnerV1 } from "./manual-context.ts";
import {
  captureMovieRollbackPlexHandoffExecutionV1,
  movieRollbackExecutionFreshnessV1,
  type MovieRollbackHandoffExecutionV1,
} from "#infrastructure/movie-editions/rollback/retry/handoff-execution.ts";

/** Manual rebind follows the actual new owner consent. It never borrows the
 * original B requester's choice, active request or expired mapping. */
export async function captureRequestedMovieRollbackPlexExpectedV1(
  tx: Prisma.TransactionClient,
  input: {
    command: MovieRollbackOperationV1;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
    handoff?: MovieRollbackHandoffExecutionV1;
  },
) {
  const { invocation, access } = input;
  invocation.execution.assertActive();
  const command = await readRequestedMovieRollbackCommandV1(
    tx,
    input.command,
    invocation.budget,
  );
  const authority = await captureRequestedMovieRollbackOwnerV1(tx, {
    actorId: command.payload.actorId,
    scope: command.source.scope,
    access,
    invocation,
    expected: command.expected,
    phase: "rebind",
  });
  await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${command.operation.id} FOR UPDATE`;
  const parent = await readMovieRollbackPhysicalV1(
    tx,
    { mode: "manual_verified", command: input.command, source: command.source },
    invocation.budget,
  );
  if (
    parent === null ||
    authority.target.availability !== "importing" ||
    identityHash(parent.intent.access) !== identityHash(access)
  )
    throw new PlexBindingProtection("ownership_changed");
  const handoff = await captureMovieRollbackPlexHandoffExecutionV1(tx, parent, {
    ...(input.handoff === undefined ? {} : { handoff: input.handoff }),
    invocation,
    access,
    phase: "plex",
    queriedOwner: { tx, access, owner: authority.owner },
  });
  const ids = [parent.asset.id, parent.receipt.successor.id].sort();
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
    throw new PlexBindingProtection("ownership_changed");
  const asset = await snapshotMoviePublicationAssetV2(
    tx,
    command.source.scope,
    parent.asset.id,
    invocation.budget,
  );
  const rejected = await snapshotMoviePublicationAssetV2(
    tx,
    command.source.scope,
    parent.receipt.successor.id,
    invocation.budget,
  );
  if (
    identityHash(asset) !== identityHash(parent.asset) ||
    identityHash(rejected) !== identityHash(parent.receipt.successor)
  )
    throw new PlexBindingProtection("ownership_changed");
  const scope = {
    mediaId: command.source.scope.mediaId,
    edition: command.source.scope.edition,
  };
  const pointer = await readPlexPointer(tx, scope, invocation.budget);
  if (
    pointer.current !== null ||
    identityHash(pointer.expected) !==
      identityHash(parent.receipt.retiredPointer)
  )
    throw new PlexBindingProtection("binding_changed");
  const canonicalTargets = await readPlexCanonicalTargets(tx, [scope]);
  invocation.budget.consume(canonicalTargets.length);
  const canonical = canonicalTargets[0];
  if (
    canonical?.kind !== "movie" ||
    canonical.canonicalRootId !== command.source.scope.rootMediaId
  )
    throw new PlexBindingProtection("scope_changed");
  const definition = await readPlexDefinition(
    tx,
    scope,
    command.source.scope.rootMediaId,
  );
  invocation.budget.consume(2);
  const profile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: parent.intent.authority.profileId },
  });
  invocation.budget.consume(1);
  if (
    authority.target.profileId !== profile.id ||
    profile.version !== parent.intent.authority.profileVersion
  )
    throw new PlexBindingProtection("scope_changed");
  const writer = await readRuntimeProof(tx);
  invocation.budget.consume(1);
  if (
    writer.revokedAt !== null ||
    writer.recoveryEpoch !== command.expected.recoveryEpoch ||
    writer.observedAt.getTime() > Date.now()
  )
    throw new PlexBindingProtection("ownership_changed");
  const expected = MovieRollbackPlexExpectedV1Schema.parse({
    schemaVersion: 4,
    originalItem: parent.intent.originalItem,
    recoveryEpoch: command.expected.recoveryEpoch,
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
        editionRootId: command.source.scope.rootMediaId,
        mediaVersion: authority.media.version,
        intentVersion: authority.target.version,
        generation: authority.target.generation,
        automationEpoch: authority.target.automationEpoch,
        definition,
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
        ownershipEpoch: asset.ownershipEpoch,
        canonicalRootId: command.source.scope.rootMediaId,
        edition: command.source.scope.edition,
        coverage: [scope],
        coverageHash: identityHash([scope]),
      },
    ],
    parents: [
      {
        kind: "movie_rollback_publication_v1",
        recoveryEpoch: command.expected.recoveryEpoch,
        reference: parent.reference,
      },
    ],
  });
  const originalFreshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      invocation.execution.expiresAtMs,
      writer.expiresAt.getTime(),
      authority.freshness.expiresAtMs,
    ),
    guards: [invocation.execution, authority.freshness],
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
    handoff,
  };
}
