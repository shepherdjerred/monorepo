import type { PlexItem } from "#integrations/plex.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";
import { PlexEpisodeHierarchySchema } from "#shared/plex-binding/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { decimalId, itemGuids, matchesReferences } from "./projection.ts";
import { plexRead } from "./io.ts";
import type { AssociationContext } from "./types.ts";

export async function readMetadata(
  context: AssociationContext,
  key: string,
  cache: Map<string, PlexItem>,
) {
  const prior = cache.get(key);
  if (prior !== undefined) {
    return prior;
  }
  const item = await plexRead(
    context,
    () => context.plex.metadata(decimalId(key), context.execution.signal),
    "metadata_changed",
  );
  cache.set(key, item);
  return item;
}

export async function readHierarchy(
  context: AssociationContext,
  item: PlexItem,
  cache: Map<string, PlexItem>,
) {
  if (
    item.parentRatingKey === undefined ||
    item.grandparentRatingKey === undefined
  ) {
    throw new PlexBindingProtection("unresolved_identity");
  }
  const season = await readMetadata(context, item.parentRatingKey, cache);
  const show = await readMetadata(context, item.grandparentRatingKey, cache);
  const hierarchy = PlexEpisodeHierarchySchema.safeParse({
    episode: {
      ratingKey: item.ratingKey,
      parentRatingKey: item.parentRatingKey,
      grandparentRatingKey: item.grandparentRatingKey,
      index: item.index,
      parentIndex: item.parentIndex,
    },
    season: {
      ratingKey: season.ratingKey,
      type: season.type,
      index: season.index,
      parentRatingKey: season.parentRatingKey,
    },
    show: {
      ratingKey: show.ratingKey,
      type: show.type,
      guids: itemGuids(show),
    },
  });
  if (
    !hierarchy.success ||
    season.parentRatingKey !== show.ratingKey ||
    item.parentIndex !== season.index ||
    item.ratingKey === season.ratingKey ||
    season.ratingKey === show.ratingKey ||
    item.ratingKey === show.ratingKey
  ) {
    throw new PlexBindingProtection("metadata_changed");
  }
  return hierarchy.data;
}

export function matchesTarget(
  target: PlexCanonicalTarget,
  item: PlexItem,
  hierarchy: Awaited<ReturnType<typeof readHierarchy>> | null,
): boolean {
  if (target.kind !== item.type) {
    return false;
  }
  return target.kind === "movie"
    ? matchesReferences(itemGuids(item), target.references)
    : hierarchy !== null &&
        item.index === target.coordinate.episodeNumber &&
        item.parentIndex === target.coordinate.seasonNumber &&
        matchesReferences(hierarchy.show.guids, target.references);
}
