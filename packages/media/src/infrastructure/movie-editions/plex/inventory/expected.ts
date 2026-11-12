import type { Prisma } from "#generated/prisma/client.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import type { PlexPhysicalGroup } from "#shared/plex-binding/contract.ts";
import {
  PlexBindingExpectedSchema,
  type PlexBindingExpected,
  type PlexBindingLockScope,
} from "#shared/plex-binding/expected.ts";
import type {
  PlexAccess,
  PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import {
  captureMovieInventoryParent,
  type MovieInventoryParent,
} from "./parent.ts";
import {
  readPlexPhysicalGroup,
  readPlexDefinition,
} from "#infrastructure/plex-binding/read.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { readPlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import {
  runtimeAuthority,
  lockRuntimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export function movieInventoryParent(
  expected: PlexBindingExpected,
): MovieInventoryParent | null {
  const values = expected.parents.filter(
    (parent) => parent.kind === "existing_movie_asset_v2",
  );
  if (values.length === 0) return null;
  const parent = values[0];
  if (
    parent === undefined ||
    values.length !== 1 ||
    expected.parents.length !== 1 ||
    expected.newGroups.length !== 1 ||
    expected.targets.length !== 1 ||
    expected.targets[0]?.scope.mediaId !== parent.scope.mediaId ||
    expected.targets[0].scope.edition !== parent.scope.edition ||
    expected.newGroups[0]?.assetId !== parent.assetId ||
    expected.recoveryEpoch !== parent.recoveryEpoch
  )
    throw new PlexBindingProtection("scope_changed");
  return parent;
}

/** Named cuts retain scoped targets; this never passes through default-only ordinary lineage. */
export async function captureMovieInventoryExpected(
  tx: Prisma.TransactionClient,
  assetId: string,
  access: readonly PlexAccess[],
  budget: PublicationAuthorityReadBudget,
) {
  const captured = await captureMovieInventoryParent(tx, assetId, budget);
  if (captured === null) return null;
  const { parent, source } = captured;
  const { asset, group } = await readPlexPhysicalGroup(tx, parent.assetId);
  budget.consume(1 + group.coverage.length);
  assertPhysicalGroup(parent, source, group, asset.state);
  const member = group.coverage[0];
  if (member === undefined) throw new PlexBindingProtection("scope_changed");
  const runtime = await runtimeAuthority(tx, budget);
  if (!runtime.active || runtime.epoch !== parent.recoveryEpoch)
    throw new PlexBindingProtection("ownership_changed");
  await assertNoPublicationCompensationFence(tx, {
    mediaIds: [parent.scope.mediaId],
  });
  await assertNoSubtitleReplacement(tx, [parent.assetId]);
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: parent.scope.mediaId,
        edition: parent.scope.edition,
      },
    },
  });
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: parent.scope.mediaId },
  });
  budget.consume(2);
  if (
    media.kind !== "movie" ||
    target.editionRootId !== parent.scope.rootMediaId ||
    target.automationEpoch !== parent.recoveryEpoch
  )
    throw new PlexBindingProtection("ownership_changed");
  const canonical = await readPlexCanonicalTargets(tx, group.coverage);
  budget.consume(canonical.length);
  const identity = canonical[0];
  if (
    identity?.kind !== "movie" ||
    identity.canonicalRootId !== parent.scope.rootMediaId
  )
    throw new PlexBindingProtection("scope_changed");
  const pointer = await readPlexPointer(tx, member, budget);
  const previous = pointer.current?.association;
  if (
    previous?.schemaVersion !== 2 ||
    identityHash(previous.group) !== identityHash(group)
  )
    throw new PlexBindingProtection("binding_changed");
  if (
    access.length !== 1 ||
    access[0]?.sectionType !== "movie" ||
    identityHash(previous.access) !== identityHash(access[0])
  )
    throw new PlexBindingProtection("wrong_section");
  const definition = await readPlexDefinition(
    tx,
    member,
    parent.scope.rootMediaId,
  );
  budget.consume(2);
  return PlexBindingExpectedSchema.parse({
    schemaVersion: 1,
    recoveryEpoch: parent.recoveryEpoch,
    access,
    targets: [
      {
        scope: group.coverage[0],
        editionRootId: parent.scope.rootMediaId,
        mediaVersion: media.version,
        intentVersion: target.version,
        generation: target.generation,
        automationEpoch: target.automationEpoch,
        definition,
        canonicalIdentityHash: identity.canonicalIdentityHash,
        numberingHash: identity.numberingHash,
      },
    ],
    previous: [pointer.expected],
    oldGroups: [previous.group],
    newGroups: [group],
    parents: [parent],
  });
}

function assertPhysicalGroup(
  parent: MovieInventoryParent,
  source: MoviePublicationAssetV2,
  group: PlexPhysicalGroup,
  state: string,
) {
  if (
    state !== "published" ||
    group.canonicalRootId !== parent.scope.rootMediaId ||
    group.edition !== parent.scope.edition ||
    group.assetVersion !== parent.assetVersion ||
    group.coverage.length !== 1 ||
    group.coverage[0]?.mediaId !== parent.scope.mediaId ||
    group.checksum !== source.checksum ||
    group.sizeBytes !== source.sizeBytes ||
    group.canonicalPath !== source.path
  )
    throw new PlexBindingProtection("ownership_changed");
}

export function movieInventoryLockScope(
  expected: PlexBindingExpected,
  parent: MovieInventoryParent,
): PlexBindingLockScope {
  const server = expected.access[0];
  if (server === undefined) throw new PlexBindingProtection("wrong_section");
  return {
    expected,
    mediaIds: [parent.scope.mediaId],
    canonicalRootIds: [parent.scope.rootMediaId],
    assetIds: [parent.assetId],
    userIds: [],
    serverMachineId: server.serverMachineId,
  };
}

export async function assertMovieInventoryExpected(
  tx: Prisma.TransactionClient,
  expected: PlexBindingExpected,
  freshness: PlexBindingFreshness,
  budget: PublicationAuthorityReadBudget,
) {
  const parent = movieInventoryParent(expected);
  if (parent === null) throw new PlexBindingProtection("scope_changed");
  const current = await captureMovieInventoryExpected(
    tx,
    parent.assetId,
    expected.access,
    budget,
  );
  freshness.assertActive();
  if (current === null || identityHash(current) !== identityHash(expected))
    throw new PlexBindingProtection("scope_changed");
}

export async function lockMovieInventoryScope(
  tx: Prisma.TransactionClient,
  scope: PlexBindingLockScope,
  freshness: PlexBindingFreshness,
  budget: PublicationAuthorityReadBudget,
) {
  const parent = movieInventoryParent(scope.expected);
  if (
    parent === null ||
    identityHash(movieInventoryLockScope(scope.expected, parent)) !==
      identityHash(scope)
  )
    throw new PlexBindingProtection("scope_changed");
  freshness.assertActive();
  await lockMovieCommand(tx, parent.scope);
  if (!(await lockRuntimeAuthority(tx, parent.recoveryEpoch, budget)))
    throw new PlexBindingProtection("ownership_changed");
  await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${parent.assetId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "assetId","mediaId" FROM "AssetCoverage" WHERE "assetId"=${parent.assetId} ORDER BY "mediaId" FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE "assetId"=${parent.assetId} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + scope.serverMachineId},0))::text`;
  await bindPlexTransactionDeadline(tx, freshness);
  await assertMovieInventoryExpected(tx, scope.expected, freshness, budget);
}
