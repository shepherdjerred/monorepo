import type { PlexClient, PlexItem } from "#integrations/plex.ts";
import { MediaError } from "#application/errors.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export function archivePlexProtection(reason: string): never {
  throw new MediaError(
    reason,
    "Archive Plex evidence is unavailable or changed",
    409,
  );
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Project only identity and file location; never persist session/account/title payloads. */
function itemProjection(item: PlexItem) {
  const parts = item.Media?.flatMap((media) => media.Part) ?? [];
  if (parts.length === 0 || parts.some((part) => part.file.length === 0))
    archivePlexProtection("native_archive_plex_parts_unknown");
  return {
    ratingKey: item.ratingKey,
    kind: item.type,
    seriesKey: item.grandparentRatingKey ?? null,
    season: item.parentIndex ?? null,
    episode: item.index ?? null,
    guids: (item.Guid ?? []).map((guid) => guid.id).sort(compare),
    parts: parts
      .map((part) => ({
        path: part.file,
        size: part.size === undefined ? null : String(part.size),
      }))
      .sort((a, b) => compare(a.path, b.path)),
  };
}

export async function archiveInventory(
  plex: Pick<PlexClient, "libraryPage">,
  input: { sectionId: string; kind: "movie" | "episode" },
  signal: AbortSignal,
) {
  const items: PlexItem[] = [];
  let total: number | undefined;
  for (let page = 0; page < 50; page++) {
    signal.throwIfAborted();
    const result = await plex.libraryPage(
      { ...input, offset: items.length, limit: 200 },
      signal,
    );
    if (
      result.total > 10_000 ||
      (total !== undefined && result.total !== total)
    )
      archivePlexProtection("native_archive_plex_inventory_changed_or_large");
    total = result.total;
    items.push(...result.items);
    if (
      items.length > total ||
      new Set(items.map((item) => item.ratingKey)).size !== items.length
    )
      archivePlexProtection("native_archive_plex_inventory_ambiguous");
    if (items.length === total) {
      signal.throwIfAborted();
      const projection = items
        .map((item) => itemProjection(item))
        .sort((a, b) => compare(a.ratingKey, b.ratingKey));
      return { items, digest: snapshotHash(projection) };
    }
    if (result.items.length === 0) break;
  }
  return archivePlexProtection("native_archive_plex_inventory_incomplete");
}

export function hasArchivePart(item: PlexItem, paths: ReadonlySet<string>) {
  return (
    item.Media?.some((media) =>
      media.Part.some(
        (part) =>
          paths.has(part.file) ||
          part.file.startsWith("/data/movies/.media-control/") ||
          part.file.startsWith("/data/tv/.media-control/"),
      ),
    ) === true
  );
}

export function videoSections(sections: { key: string; type: string }[]) {
  if (new Set(sections.map((section) => section.key)).size !== sections.length)
    archivePlexProtection("native_archive_plex_sections_ambiguous");
  const video = sections
    .filter((section) => section.type === "movie" || section.type === "show")
    .map((section) => ({
      sectionId: section.key,
      kind:
        section.type === "movie" ? ("movie" as const) : ("episode" as const),
    }))
    .sort((a, b) => compare(a.sectionId, b.sectionId));
  if (video.length === 0 || video.length > 100)
    archivePlexProtection("native_archive_plex_sections_bound");
  return video;
}

export async function archiveInventoryPass(
  plex: Pick<PlexClient, "libraryPage">,
  sections: ReturnType<typeof videoSections>,
  paths: ReadonlySet<string>,
  signal: AbortSignal,
) {
  const results = [];
  const keys = new Set<string>();
  let total = 0;
  for (const section of sections) {
    const result = await archiveInventory(plex, section, signal);
    total += result.items.length;
    if (total > 10_000)
      archivePlexProtection("native_archive_plex_inventory_changed_or_large");
    for (const item of result.items) {
      if (keys.has(item.ratingKey))
        archivePlexProtection("native_archive_plex_inventory_ambiguous");
      keys.add(item.ratingKey);
      if (hasArchivePart(item, paths))
        archivePlexProtection("native_archive_plex_archive_indexed");
    }
    results.push({ ...section, ...result });
  }
  return results;
}
