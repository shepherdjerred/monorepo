import type {
  PlaylistMutationSchema,
  PlaylistPageSchema,
  PlaylistSummary,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import { playlistItem } from "@shepherdjerred/streambot/web/client/media/media-items.ts";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import type { RowAction } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { z } from "zod";

export type PlaylistPage = z.infer<typeof PlaylistPageSchema>;
export type PlaylistEntry = PlaylistPage["items"][number];

/** What one mutation says it does; the playlist and server it applies to are added when it is sent. */
export type PlaylistChange = Omit<
  z.infer<typeof PlaylistMutationSchema>,
  "guildId" | "id" | "revision"
>;

/** The server returns 50 items per page. */
export const PAGE_SIZE = 50;

export function playlistPath(id: string): string {
  return "/playlists/" + encodeURIComponent(id);
}

/** A playlist on the list page: the shared playlist row, opening its own page. */
export function playlistListItem(
  playlist: PlaylistSummary,
  listenAllowed: boolean,
  guildId: string,
): MediaItem {
  const cover = musicArtworkUrl(playlist.cover, guildId);
  return {
    ...playlistItem(playlist, listenAllowed),
    ...(cover === undefined ? {} : { artworkUrl: cover }),
    href: playlistPath(playlist.id),
  };
}

/** A music item plays as Listen (its video is one menu item away); other saved media can do both. */
function entryActions(
  entry: PlaylistEntry,
  listenAllowed: boolean,
): readonly RowAction[] {
  if (entry.selectionId === undefined) return [];
  if (!listenAllowed) return ["watch"];
  return entry.music === undefined ? ["listen", "watch"] : ["listen"];
}

/** One saved item as a row. Items the server gave no selection stay quiet. */
export function entryItem(
  entry: PlaylistEntry,
  guildId: string,
  listenAllowed: boolean,
): MediaItem {
  const music = entry.music;
  const cover = musicArtworkUrl(music, guildId);
  return {
    key: "playlist-item:" + entry.id,
    kind: music === undefined ? "video" : "song",
    title: music?.title ?? entry.title,
    ...(music === undefined ? {} : { subtitle: music.artists.join(", ") }),
    ...(music?.durationSeconds === undefined
      ? {}
      : { durationSeconds: music.durationSeconds }),
    ...(cover === undefined ? {} : { artworkUrl: cover }),
    actions: entryActions(entry, listenAllowed),
    selection:
      entry.selectionId === undefined
        ? null
        : { kind: "music", id: entry.selectionId },
  };
}

/** The 1-based position the server expects when an item at 0-based `index` moves one place. */
export function movePosition(
  index: number,
  direction: "up" | "down",
  count: number,
): number | null {
  const position = direction === "up" ? index : index + 2;
  return position < 1 || position > count ? null : position;
}

export type PlaylistRequest = PlaylistChange & {
  guildId: string;
  id?: string;
  revision?: number;
};

/** The request body for one mutation, bound to the playlist revision the viewer saw. */
export function playlistRequest(
  guildId: string,
  target: { readonly id: string; readonly revision: number } | null,
  change: PlaylistChange,
): PlaylistRequest {
  return {
    ...change,
    guildId,
    ...(target === null ? {} : { id: target.id, revision: target.revision }),
  };
}

/** A name for the private copy of a playlist. */
export function copyName(name: string): string {
  return (name + " copy").slice(0, 100);
}

export type PlaylistsSearch = {
  /** A playlist the address asks to open (classic share links and `?playlist=`). */
  readonly playlist: string | null;
  /** The server the link was made for. */
  readonly guild: string | null;
  /** A link to import, from `?import=`. */
  readonly importUrl: string;
};

/**
 * Reads the addresses the classic remote made: `/playlists?guild=<id>&playlist=<id>` share links and
 * `/playlists?import=<url>` from a search result.
 */
export function parsePlaylistsSearch(params: URLSearchParams): PlaylistsSearch {
  const playlist = params.get("playlist");
  const guild = params.get("guild");
  return {
    playlist:
      playlist === null || playlist === "" || playlist.length > 100
        ? null
        : playlist,
    guild: guild !== null && /^\d+$/u.test(guild) ? guild : null,
    importUrl: params.get("import") ?? "",
  };
}

/**
 * The query parameters a share link carries, each an id of a known shape: the server (a Discord
 * snowflake) and the playlist (every playlist id is a `crypto.randomUUID()`).
 */
const SHARE_LINK_PARAMETERS = {
  guild: z.string().regex(/^\d{1,20}$/u),
  playlist: z.uuid(),
} as const;

/**
 * Where signing in returns to: the page's path plus only the share-link ids it carries, so a
 * shared playlist still opens in the right server afterwards. Every other parameter is dropped,
 * because `returnTo` travels to Discord in the OAuth `state` and a query can hold search text.
 */
export function signInReturnTo(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const [key, schema] of Object.entries(SHARE_LINK_PARAMETERS)) {
    const value = schema.safeParse(params.get(key));
    if (value.success) kept.set(key, value.data);
  }
  const query = kept.toString();
  return query === "" ? pathname : pathname + "?" + query;
}

/** The link a viewer sends to another member of the server. */
export function shareUrl(
  origin: string,
  guildId: string,
  playlistId: string,
): string {
  return (
    origin +
    playlistPath(playlistId) +
    "?" +
    new URLSearchParams({ guild: guildId }).toString()
  );
}

const NavigationNoticeSchema = z.strictObject({ notice: z.string() });

/** The note an import left for the page it navigated to (for example, items it skipped). */
export function navigationNotice(state: unknown): string {
  const parsed = NavigationNoticeSchema.safeParse(state);
  return parsed.success ? parsed.data.notice : "";
}

export function isSpotifyLink(value: string): boolean {
  try {
    return new URL(value.trim()).hostname === "open.spotify.com";
  } catch {
    return false;
  }
}

export function playlistDetail(page: PlaylistPage): string {
  const count = `${String(page.count)} item${page.count === 1 ? "" : "s"}`;
  if (page.guildId === null) return count + " · Private";
  return count + (page.owned ? " · Shared with this server" : " · Shared");
}
