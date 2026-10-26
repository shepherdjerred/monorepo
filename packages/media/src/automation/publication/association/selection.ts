import type { PlexItem } from "#integrations/plex.ts";
import {
  PlexAssociationV1Schema,
  plexScopeKey,
  type PlexAssociationV1,
  type PlexBindingScope,
  type PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { associationHash, compare, projectItem } from "./projection.ts";
import { matchesTarget, readHierarchy, readMetadata } from "./hierarchy.ts";
import type { AssociationContext } from "./types.ts";
import type { ServingScope } from "./scope.ts";
import type { InventoryItem } from "./scan.ts";

async function groupDetails(
  context: AssociationContext,
  group: PlexPhysicalGroup,
  inventory: readonly InventoryItem[],
  cache: Map<string, PlexItem>,
) {
  const candidates = inventory.filter((row) =>
    row.projection.media.some((version) =>
      version.parts.some((part) => part.file === group.canonicalPath),
    ),
  );
  if (candidates.length !== group.coverage.length) {
    throw new PlexBindingProtection("ambiguous_item");
  }
  const details = [];
  for (const candidate of candidates) {
    const item = await readMetadata(context, candidate.item.ratingKey, cache);
    const projection = projectItem(item);
    if (associationHash(projection) !== associationHash(candidate.projection)) {
      throw new PlexBindingProtection("metadata_changed");
    }
    const version = projection.media[0],
      part = version?.parts[0];
    if (
      part === undefined ||
      projection.media.length !== 1 ||
      version?.parts.length !== 1
    ) {
      throw new PlexBindingProtection("unsupported_media_parts");
    }
    if (
      part.file !== group.canonicalPath ||
      (part.sizeBytes !== undefined && part.sizeBytes !== group.sizeBytes)
    ) {
      throw new PlexBindingProtection("metadata_changed");
    }
    details.push({
      item,
      projection,
      part,
      section: candidate.section,
      hierarchy:
        item.type === "episode"
          ? await readHierarchy(context, item, cache)
          : null,
    });
  }
  if (new Set(details.map((row) => row.part.id)).size !== 1) {
    throw new PlexBindingProtection("ambiguous_item");
  }
  return details;
}

function assertInventoryPart(
  row: InventoryItem,
  part: InventoryItem["projection"]["media"][number]["parts"][number],
  selected: PlexAssociationV1 | undefined,
  claimed: PlexAssociationV1,
) {
  if (
    selected?.group.assetId !== claimed.group.assetId ||
    selected.item.media[0].parts[0].id !== part.id ||
    selected.group.canonicalPath !== part.file ||
    selected.access.sectionId !== row.section.sectionId
  ) {
    throw new PlexBindingProtection("ambiguous_item");
  }
}

function assertNoForeignParts(
  inventory: readonly InventoryItem[],
  associations: readonly PlexAssociationV1[],
) {
  const byKey = new Map(associations.map((row) => [row.item.ratingKey, row]));
  const byPart = new Map<string, PlexAssociationV1>();
  const byPath = new Map<string, PlexAssociationV1>();
  for (const row of associations) {
    const part = row.item.media[0].parts[0];
    for (const prior of [byPart.get(part.id), byPath.get(part.file)]) {
      if (
        prior !== undefined &&
        associationHash(prior.group) !== associationHash(row.group)
      ) {
        throw new PlexBindingProtection("ambiguous_item");
      }
    }
    byPart.set(part.id, row);
    byPath.set(part.file, row);
  }
  for (const row of inventory) {
    for (const part of row.projection.media.flatMap(
      (version) => version.parts,
    )) {
      const claimed = byPart.get(part.id) ?? byPath.get(part.file);
      if (claimed === undefined) {
        continue;
      }
      assertInventoryPart(row, part, byKey.get(row.item.ratingKey), claimed);
    }
  }
}

function selectMember(
  scope: ServingScope,
  group: PlexPhysicalGroup,
  member: PlexBindingScope,
  details: Awaited<ReturnType<typeof groupDetails>>,
): PlexAssociationV1 {
  const key = plexScopeKey(member),
    canonical = scope.canonicalByScope.get(key),
    target = scope.targets.get(key);
  if (canonical === undefined || target === undefined) {
    throw new Error("Serving canonical scope disappeared");
  }
  const matches = details.filter((row) =>
    matchesTarget(canonical, row.item, row.hierarchy),
  );
  const found = matches[0];
  if (found === undefined || matches.length !== 1) {
    throw new PlexBindingProtection("metadata_changed");
  }
  const access = scope.access.find(
    (row) =>
      row.sectionId === found.section.sectionId &&
      row.sectionType === found.section.sectionType,
  );
  if (access === undefined) {
    throw new PlexBindingProtection("wrong_section");
  }
  return PlexAssociationV1Schema.parse({
    schemaVersion: 1,
    scope: member,
    editionRootId: target.editionRootId,
    definition: target.definition,
    canonicalIdentityHash: target.canonicalIdentityHash,
    numberingHash: target.numberingHash,
    group,
    access,
    kind: canonical.kind,
    item: {
      ratingKey: found.item.ratingKey,
      type: found.item.type,
      guids: found.projection.guids,
      media: [{ parts: [found.part] }],
    },
    ...(found.hierarchy === null ? {} : { hierarchy: found.hierarchy }),
  });
}

export async function selectAssociations(
  context: AssociationContext,
  scope: ServingScope,
  inventory: readonly InventoryItem[],
) {
  const associations: PlexAssociationV1[] = [];
  const cache = new Map<string, PlexItem>();
  for (const group of scope.expected.newGroups) {
    const details = await groupDetails(context, group, inventory, cache);
    for (const member of group.coverage) {
      associations.push(selectMember(scope, group, member, details));
    }
  }
  if (
    new Set(associations.map((row) => row.item.ratingKey)).size !==
    associations.length
  ) {
    throw new PlexBindingProtection("ambiguous_item");
  }
  assertNoForeignParts(inventory, associations);
  return associations.sort((a, b) =>
    compare(plexScopeKey(a.scope), plexScopeKey(b.scope)),
  );
}
