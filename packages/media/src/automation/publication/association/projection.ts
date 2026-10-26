import type { PlexItem } from "#integrations/plex.ts";
import { z } from "zod";
import {
  CatalogReferenceSchema,
  type CatalogReference,
} from "#shared/acquisition/catalog.ts";
import { matchesReferences as matchesCanonicalReferences } from "#shared/plex-binding/canonical.ts";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { PlexAssociation } from "#shared/plex-binding/contract.ts";

export const compare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function associationHash(value: unknown): string {
  return snapshotHash(z.json().parse(value));
}

export function decimalId(value: string): string {
  const parsed = PlexDecimalIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new PlexBindingProtection("metadata_changed");
  }
  return parsed.data;
}

function wireNumber(value: number, positive: boolean): string {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new PlexBindingProtection("metadata_changed");
  }
  return String(value);
}

export function itemGuids(item: PlexItem): string[] {
  const guids = [
    ...new Set([
      ...(item.guid === undefined ? [] : [item.guid]),
      ...(item.Guid ?? []).map((value) => value.id),
    ]),
  ].sort(compare);
  const providers = new Map<string, string>();
  if (
    guids.length > 100 ||
    guids.some((value) => value.length === 0 || value.length > 2048)
  ) {
    throw new PlexBindingProtection("metadata_changed");
  }
  for (const guid of guids) {
    const match = /^(tmdb|imdb|tvdb):\/\/(.*)$/u.exec(guid);
    if (match === null) {
      continue;
    }
    const reference = CatalogReferenceSchema.safeParse({
      kind: "movie",
      namespace: match[1],
      value: match[2],
    });
    if (!reference.success) {
      throw new PlexBindingProtection("metadata_changed");
    }
    const prior = providers.get(reference.data.namespace);
    if (prior !== undefined && prior !== reference.data.value) {
      throw new PlexBindingProtection("ambiguous_item");
    }
    providers.set(reference.data.namespace, reference.data.value);
  }
  return guids;
}

export function matchesReferences(
  guids: readonly string[],
  references: readonly CatalogReference[],
): boolean {
  return matchesCanonicalReferences(guids, references);
}

export function projectItem(item: PlexItem) {
  if (item.type !== "movie" && item.type !== "episode") {
    throw new PlexBindingProtection("metadata_changed");
  }
  const media = (item.Media ?? [])
    .map((version) => ({
      parts: version.Part.map((part) => {
        if (part.file.length === 0 || part.file.length > 4096) {
          throw new PlexBindingProtection("metadata_changed");
        }
        return {
          id: wireNumber(part.id, true),
          file: part.file,
          ...(part.size === undefined
            ? {}
            : { sizeBytes: wireNumber(part.size, false) }),
        };
      }).sort((a, b) => compare(a.id, b.id) || compare(a.file, b.file)),
    }))
    .sort((a, b) => compare(associationHash(a), associationHash(b)));
  if (
    media.length === 0 ||
    media.some((version) => version.parts.length === 0)
  ) {
    throw new PlexBindingProtection("unsupported_media_parts");
  }
  return {
    ratingKey: decimalId(item.ratingKey),
    type: item.type,
    guids: itemGuids(item),
    media,
    parentRatingKey: item.parentRatingKey ?? null,
    grandparentRatingKey: item.grandparentRatingKey ?? null,
    index: item.index ?? null,
    parentIndex: item.parentIndex ?? null,
  };
}

export type ProjectedItem = ReturnType<typeof projectItem>;

export function observedEditionTitle(item: PlexItem): string | null {
  return item.editionTitle === "" ? null : (item.editionTitle ?? null);
}

/** Preserve the original projection unless this caller explicitly verifies movie edition metadata. */
export function projectMovieEditionItem(item: PlexItem) {
  return { ...projectItem(item), editionTitle: observedEditionTitle(item) };
}

/** Compare watch/session data against the literal version of its stored association. */
export function projectAssociatedItem(
  item: PlexItem,
  association: PlexAssociation,
) {
  const value = projectItem(item);
  return {
    ratingKey: value.ratingKey,
    type: value.type,
    guids: value.guids,
    media: value.media,
    ...(association.schemaVersion === 2
      ? { editionTitle: observedEditionTitle(item) }
      : {}),
  };
}
