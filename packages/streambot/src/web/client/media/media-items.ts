import type {
  LibraryBrowsePageSchema,
  LibraryItemSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { PlaylistSummary } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import type { RowAction } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { z } from "zod";
import type { MediaItem } from "./row-model.ts";

type LibraryTitle = z.infer<typeof LibraryBrowsePageSchema>["items"][number];
type LibraryEntry = z.infer<typeof LibraryItemSchema>;

function joined(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

/** A library file plays only as video; a series opens its episodes. */
export function libraryItem(title: LibraryTitle): MediaItem {
  const artwork =
    title.artworkUrl === undefined ? {} : { artworkUrl: title.artworkUrl };
  if ("kind" in title && title.kind === "series")
    return {
      key: "series:" + title.id,
      kind: "series",
      title: title.series,
      subtitle: joined([
        title.library,
        `${String(title.episodes)} episode${title.episodes === 1 ? "" : "s"}`,
      ]),
      ...artwork,
      actions: [],
      selection: null,
      href:
        "/library?" + new URLSearchParams({ series: title.series }).toString(),
    };
  return libraryEntry(title);
}

export function libraryEntry(entry: LibraryEntry): MediaItem {
  const episode =
    entry.season === undefined || entry.episode === undefined
      ? undefined
      : `S${String(entry.season)} · E${String(entry.episode)}`;
  return {
    key: "library:" + entry.id,
    kind: "library",
    title: entry.title,
    subtitle: joined([episode ?? entry.library, entry.year?.toString()]),
    ...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl }),
    actions: ["watch"],
    selection: { kind: "library", id: entry.id },
  };
}

/**
 * A saved playlist. The server does not say how a playlist should play, so it offers both
 * destinations when Listen is allowed, Listen first because playlists are mostly music.
 */
export function playlistItem(
  playlist: PlaylistSummary,
  listenAllowed: boolean,
): MediaItem {
  const actions: RowAction[] = listenAllowed ? ["listen", "watch"] : ["watch"];
  return {
    key: "playlist:" + playlist.id,
    kind: "playlist",
    title: playlist.name,
    subtitle: joined([
      `${String(playlist.count)} item${playlist.count === 1 ? "" : "s"}`,
      playlist.owned ? undefined : "Shared",
    ]),
    actions: playlist.count === 0 ? [] : actions,
    href: "/playlists/" + encodeURIComponent(playlist.id),
    selection: {
      kind: "playlist",
      id: playlist.id,
      revision: playlist.revision,
    },
  };
}
