import type { PlexItem } from "#integrations/plex.ts";
import type { PlexCanonicalTarget } from "#shared/plex-binding/canonical.ts";
import {
  PlexItemIdentitySchema,
  type PlexAccess,
} from "#shared/plex-binding/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  projectItem,
  associationHash,
  decimalId,
} from "#automation/publication/association/projection.ts";
import {
  readMetadata,
  readHierarchy,
  matchesTarget,
} from "#automation/publication/association/hierarchy.ts";
import type { AssociationContext } from "#automation/publication/association/types.ts";
import type { InventoryItem } from "#automation/publication/association/scan.ts";

export type NativeCatalogGroup = {
  canonicalPath: string;
  access: PlexAccess;
  targets: readonly PlexCanonicalTarget[];
  allowedSizes: readonly string[];
  required: boolean;
};

function section(item: PlexItem, access: PlexAccess) {
  if (item.librarySectionID === undefined) return {};
  const sectionId = decimalId(String(item.librarySectionID));
  if (sectionId !== access.sectionId)
    throw new PlexBindingProtection("wrong_section");
  return { sectionId };
}

async function readCandidate(
  context: AssociationContext,
  row: InventoryItem,
  group: NativeCatalogGroup,
  cache: Map<string, PlexItem>,
) {
  if (
    row.section.sectionId !== group.access.sectionId ||
    row.section.sectionType !== group.access.sectionType
  )
    throw new PlexBindingProtection("wrong_section");
  const wire = await readMetadata(context, row.projection.ratingKey, cache);
  const projected = projectItem(wire);
  if (associationHash(projected) !== associationHash(row.projection))
    throw new PlexBindingProtection("metadata_changed");
  const identity = PlexItemIdentitySchema.safeParse({
    ratingKey: projected.ratingKey,
    type: projected.type,
    guids: projected.guids,
    media: projected.media,
  });
  if (!identity.success)
    throw new PlexBindingProtection("unsupported_media_parts");
  const part = identity.data.media[0].parts[0];
  if (
    part.file !== group.canonicalPath ||
    (part.sizeBytes !== undefined &&
      !group.allowedSizes.includes(part.sizeBytes))
  )
    throw new PlexBindingProtection("metadata_changed");
  const base =
    wire.type === "episode" ? await readHierarchy(context, wire, cache) : null;
  const hierarchy =
    base === null
      ? null
      : {
          ...base,
          season: {
            ...base.season,
            ...section(
              requiredCache(cache, base.season.ratingKey),
              group.access,
            ),
          },
          show: {
            ...base.show,
            ...section(requiredCache(cache, base.show.ratingKey), group.access),
          },
        };
  return {
    wire,
    identity: identity.data,
    hierarchy,
    series:
      base === null ? undefined : requiredCache(cache, base.show.ratingKey),
    ...section(wire, group.access),
  };
}

function requiredCache(cache: Map<string, PlexItem>, key: string): PlexItem {
  const value = cache.get(key);
  if (value === undefined)
    throw new Error("Native hierarchy metadata disappeared");
  return value;
}

/** Review describes catalog compatibility with the immutable descriptor, never current byte ownership. */
export async function selectNativeCatalog(
  context: AssociationContext,
  groups: readonly NativeCatalogGroup[],
  inventory: readonly InventoryItem[],
) {
  const cache = new Map<string, PlexItem>();
  const selected = [];
  const usedKeys = new Set<string>();
  for (const group of groups) {
    const candidates = inventory.filter((row) =>
      row.projection.media.some((media) =>
        media.parts.some((part) => part.file === group.canonicalPath),
      ),
    );
    if (candidates.length === 0 && !group.required) {
      selected.push({ group, items: [] });
      continue;
    }
    if (candidates.length !== group.targets.length)
      throw new PlexBindingProtection("ambiguous_item");
    const details: Awaited<ReturnType<typeof readCandidate>>[] = [];
    for (const candidate of candidates)
      details.push(await readCandidate(context, candidate, group, cache));
    const items = group.targets.map((target) => {
      const matches = details.filter((detail) =>
        matchesTarget(target, detail.wire, detail.hierarchy),
      );
      const detail = matches[0];
      if (
        detail === undefined ||
        matches.length !== 1 ||
        usedKeys.has(detail.identity.ratingKey)
      )
        throw new PlexBindingProtection("unresolved_identity");
      usedKeys.add(detail.identity.ratingKey);
      const part = detail.identity.media[0].parts[0];
      if (
        inventory.some((row) =>
          row.projection.media.some((media) =>
            media.parts.some(
              (other) =>
                other.id === part.id &&
                (other.file !== part.file ||
                  other.sizeBytes !== part.sizeBytes),
            ),
          ),
        )
      )
        throw new PlexBindingProtection("ambiguous_item");
      return { target, ...detail };
    });
    selected.push({ group, items });
  }
  return selected;
}

export type NativeCatalogSelection = Awaited<
  ReturnType<typeof selectNativeCatalog>
>;
