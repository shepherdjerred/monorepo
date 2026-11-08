import nodePath from "node:path";
import { FileGuardError } from "./types.ts";

type Identity = {
  kind: string;
  title: string;
  year: number | null;
  tmdbId: number | null;
};
export type NamingItem = Identity & {
  id: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  parent: (Identity & { parent: Identity | null }) | null;
};
function safeTitle(title: string): string {
  const result = title
    .replaceAll(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 120);
  if (result.length === 0) throw new FileGuardError("library_title_invalid");
  return result;
}
function identityName(item: Identity): string {
  if (item.tmdbId === null)
    throw new FileGuardError("library_external_identity_missing");
  const year = item.year === null ? "" : ` (${String(item.year)})`;
  return `${safeTitle(item.title)}${year} {tmdb-${String(item.tmdbId)}}`;
}

/** Plex filenames use catalog identities and explicit episode numbers, never local UUIDs. */
export function newLibraryPath(
  items: readonly NamingItem[],
  sourceFilename: string,
): string {
  const first = items[0];
  if (first === undefined) throw new FileGuardError("media_missing");
  const extension = nodePath.extname(sourceFilename).toLowerCase();
  if (first.kind === "movie" && items.length === 1) {
    const name = identityName(first);
    return `${name}/${name}${extension}`;
  }
  const series =
    first.parent?.kind === "series" ? first.parent : first.parent?.parent;
  if (
    series?.kind !== "series" ||
    first.seasonNumber === null ||
    items.some(
      (item) =>
        item.kind !== "episode" ||
        item.seasonNumber !== first.seasonNumber ||
        item.episodeNumber === null,
    )
  )
    throw new FileGuardError("series_metadata_missing");
  const episodes = items
    .map((item) => {
      if (item.episodeNumber === null)
        throw new FileGuardError("episode_number_missing");
      return item.episodeNumber;
    })
    .sort((left, right) => left - right);
  if (
    episodes.some(
      (episode, index) =>
        index > 0 && episode !== (episodes[index - 1] ?? -2) + 1,
    )
  )
    throw new FileGuardError("file_coverage_discontinuous");
  const season = String(first.seasonNumber).padStart(2, "0");
  const start = String(episodes[0]).padStart(2, "0");
  const end =
    episodes.length > 1 ? `-E${String(episodes.at(-1)).padStart(2, "0")}` : "";
  return `${identityName(series)}/Season ${season}/${safeTitle(series.title)} - S${season}E${start}${end} - ${safeTitle(first.title)}${extension}`;
}
