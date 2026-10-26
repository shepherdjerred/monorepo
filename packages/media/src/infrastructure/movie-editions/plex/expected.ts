import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { lockMovieChoiceIdentities } from "#infrastructure/movie-editions/access.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import { readPlexDefinition } from "#infrastructure/plex-binding/read.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { assertMovieAcquisitionOperationV4 } from "#infrastructure/movie-editions/lifecycle/operation.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import { assertPublicationSnapshotSuccessor } from "#infrastructure/publication-proof/authority.ts";

/** Caller starts at the complete canonical/target/request scope; every later phase recaptures this exact snapshot. */
export async function captureMoviePlexExpectedV2(
  tx: Prisma.TransactionClient,
  input: MovieAttemptOperationV4,
  access: MovieChoiceAccess,
  budget: PublicationAuthorityReadBudget,
) {
  await lockMovieCommand(tx, input.scope);
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  if (
    attempt.state !== "imported" ||
    attempt.coordinatorOperationId !== input.operationId ||
    !(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))
  )
    throw new PlexBindingProtection("ownership_changed");
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: [input.scope.mediaId],
  });
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  await lockMovieChoiceIdentities(tx, { mediaIds: [input.scope.mediaId] });
  const authority = await movieAttemptEffectAuthorityV4(
    tx,
    attempt,
    input.scope,
    access,
  );
  if (authority === null) throw new PlexBindingProtection("scope_changed");
  const coordinator = await assertMovieAcquisitionOperationV4(
    tx,
    input.operationId,
    input.scope,
    attempt.recoveryEpoch,
  );
  const command = coordinator.operation;
  if (coordinator.input.generation !== authority.target.generation)
    throw new PlexBindingProtection("scope_changed");
  const publication = await loadMoviePublicationV2(tx, attempt.id, budget);
  if (
    publication?.outcome?.kind !== "published" ||
    publication.outcomeHash === null
  )
    throw new PlexBindingProtection("ownership_changed");
  const original = publication.outcome.entries[0].successor;
  if (original === null)
    throw new Error("Published movie outcome has no successor");
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${original.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT "assetId" FROM "AssetCoverage" WHERE "assetId"=${original.id} ORDER BY "mediaId",edition FOR UPDATE`;
  const asset = await snapshotMoviePublicationAssetV2(
    tx,
    input.scope,
    original.id,
    budget,
  );
  assertCurrentMoviePlexAsset(original, asset, attempt.recoveryEpoch);
  const scope = { mediaId: input.scope.mediaId, edition: input.scope.edition };
  const canonicalTargets = await readPlexCanonicalTargets(tx, [scope]);
  const canonical = canonicalTargets[0];
  if (
    canonical?.kind !== "movie" ||
    canonical.canonicalRootId !== input.scope.rootMediaId
  )
    throw new PlexBindingProtection("scope_changed");
  const definition = await readPlexDefinition(
    tx,
    scope,
    input.scope.rootMediaId,
  );
  const pointer = await readPlexPointer(tx, scope, budget);
  const previousGroup = moviePlexPreviousGroup(pointer, input, access);
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.scope.mediaId },
  });
  const coverage = [scope];
  const expected = PlexBindingExpectedSchema.parse({
    schemaVersion: 1,
    recoveryEpoch: attempt.recoveryEpoch,
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
        editionRootId: input.scope.rootMediaId,
        mediaVersion: media.version,
        intentVersion: authority.target.version,
        generation: authority.target.generation,
        automationEpoch: authority.target.automationEpoch,
        definition,
        canonicalIdentityHash: canonical.canonicalIdentityHash,
        numberingHash: canonical.numberingHash,
      },
    ],
    previous: [pointer.expected],
    oldGroups: previousGroup === undefined ? [] : [previousGroup],
    newGroups: [
      {
        assetId: asset.id,
        assetVersion: asset.version,
        checksum: asset.checksum,
        sizeBytes: asset.sizeBytes,
        canonicalPath: asset.path,
        ownershipEpoch: asset.ownershipEpoch,
        canonicalRootId: input.scope.rootMediaId,
        edition: input.scope.edition,
        coverage,
        coverageHash: identityHash(coverage),
      },
    ],
    parents: [
      {
        kind: "acquisition",
        attemptId: attempt.id,
        operationId: attempt.operationId,
        planHash: publication.reference.intent.filePlanHash,
        identityHash: identityHash(attempt.identityEvidence),
        recoveryEpoch: attempt.recoveryEpoch,
        generations: attempt.generations,
      },
    ],
  });
  authority.freshness.assertActive();
  return {
    expected,
    canonicalTargets,
    attempt,
    command,
    publication,
    authority,
    asset,
    leaseExpiresAtMs: lease.expiresAt.getTime(),
  };
}

function assertCurrentMoviePlexAsset(
  original: MoviePublicationAssetV2,
  asset: MoviePublicationAssetV2,
  epoch: number,
) {
  if (
    asset.state !== "published" ||
    asset.ownershipEpoch !== epoch ||
    !asset.coverage[0].current
  )
    throw new PlexBindingProtection("ownership_changed");
  assertPublicationSnapshotSuccessor(
    { ...original, subtitles: asset.subtitles },
    asset,
  );
}

function moviePlexPreviousGroup(
  pointer: Awaited<ReturnType<typeof readPlexPointer>>,
  input: MovieAttemptOperationV4,
  access: MovieChoiceAccess,
) {
  if (pointer.current === null) return;
  const { association } = pointer.current;
  const group = association.group;
  if (
    group.canonicalRootId !== input.scope.rootMediaId ||
    group.edition !== input.scope.edition ||
    group.coverage.length !== 1 ||
    group.coverage[0]?.mediaId !== input.scope.mediaId ||
    association.access.serverMachineId !== access.serverMachineId
  )
    throw new PlexBindingProtection("scope_changed");
  return group;
}
