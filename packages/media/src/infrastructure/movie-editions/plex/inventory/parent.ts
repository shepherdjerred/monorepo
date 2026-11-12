import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexPublicationParent } from "#shared/plex-binding/expected.ts";
import { ExistingMovieAssetPlexParentV2Schema } from "#shared/plex-binding/expected.ts";
import { PlexBindingScopeSchema } from "#shared/plex-binding/contract.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

export type MovieInventoryParent = Extract<
  PlexPublicationParent,
  { kind: "existing_movie_asset_v2" }
>;

/** Only an actual current schema2 movie association selects the scoped protocol. */
export async function captureMovieInventoryParent(
  tx: Prisma.TransactionClient,
  assetId: string,
  budget: PublicationAuthorityReadBudget,
) {
  const coverage = await tx.assetCoverage.findMany({
    where: { assetId, current: true, media: { kind: "movie" } },
    select: { mediaId: true, edition: true },
    take: 2,
  });
  budget.consume(coverage.length);
  if (coverage.length === 0) return null;
  const member = coverage[0];
  if (member === undefined || coverage.length !== 1)
    throw new PlexBindingProtection("scope_changed");
  const selected = PlexBindingScopeSchema.parse(member);
  const pointer = await readPlexPointer(tx, selected, budget);
  if (
    pointer.current === null ||
    pointer.current.association.schemaVersion === 1
  )
    return null;
  const scope = MovieEditionScopeSchema.parse({
    rootMediaId: member.mediaId,
    ...selected,
  });
  const asset = await snapshotMoviePublicationAssetV2(
    tx,
    scope,
    assetId,
    budget,
  );
  const group = pointer.current.association.group;
  if (
    group.assetId !== assetId ||
    group.assetVersion !== asset.version ||
    group.ownershipEpoch !== asset.ownershipEpoch ||
    group.edition !== scope.edition ||
    group.canonicalRootId !== scope.rootMediaId ||
    asset.state !== "published" ||
    !asset.coverage[0].current
  )
    throw new PlexBindingProtection("ownership_changed");
  const physicalGrant = await findMoviePublicationReferenceV2(
    tx,
    { scope, asset },
    budget,
  );
  if (physicalGrant === null)
    throw new PlexBindingProtection("ownership_changed");
  const parent = ExistingMovieAssetPlexParentV2Schema.parse({
    kind: "existing_movie_asset_v2",
    scope,
    assetId,
    assetVersion: asset.version,
    recoveryEpoch: asset.ownershipEpoch,
    physicalGrant,
  });
  return { parent, source: asset };
}
