import { isLikelyPlaylist } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { MusicError } from "./errors.ts";
import type { PlaylistContent } from "./playlists.ts";
import { musicSource } from "./service.ts";
import { spotifyLink, type SpotifyMetadata } from "./spotify.ts";

export type ImportedPlaylist = {
  title: string;
  items: PlaylistContent[];
  warning: string;
  provider: "spotify" | "youtube";
};

export type PlaylistImportDeps = {
  spotify: Pick<SpotifyMetadata, "load">;
  expandPlaylistWithMetadata?: (
    url: string,
    signal: AbortSignal,
  ) => Promise<{
    title: string | undefined;
    items: readonly { title: string; url: string }[];
  }>;
  requireSpotifyAllowed?: () => Promise<void> | void;
};

const MAX_PLAYLIST_NAME_LENGTH = 100;

export function normalizeExternalPlaylistUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/^<(https?:\/\/[^<>]+)>$/u, "$1");
}

export function playlistImportNotice(
  imported: Pick<ImportedPlaylist, "items" | "warning">,
): string {
  return (
    `Imported ${String(imported.items.length)} item(s).` +
    (imported.warning === "" ? "" : ` ${imported.warning}`)
  );
}

export function disambiguatePlaylistName(
  existingNames: readonly string[],
  baseName: string,
): string {
  const trimmed = baseName.trim();
  const normalizedBase = (trimmed === "" ? "Imported playlist" : trimmed)
    .slice(0, MAX_PLAYLIST_NAME_LENGTH)
    .trimEnd();
  const fallbackBase =
    normalizedBase === "" ? "Imported playlist" : normalizedBase;
  const taken = new Set(existingNames);
  if (!taken.has(fallbackBase)) {
    return fallbackBase;
  }
  for (let index = 2; ; index += 1) {
    const suffix = ` (${String(index)})`;
    const prefix = fallbackBase
      .slice(0, MAX_PLAYLIST_NAME_LENGTH - suffix.length)
      .trimEnd();
    const candidate = `${prefix}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

export async function importExternalPlaylist(
  rawUrl: string,
  deps: PlaylistImportDeps,
  signal: AbortSignal,
): Promise<ImportedPlaylist> {
  const url = normalizeExternalPlaylistUrl(rawUrl);
  const spotifyUrl = spotifyLink(url);
  if (spotifyUrl !== null) {
    await deps.requireSpotifyAllowed?.();
    const result = await deps.spotify.load(spotifyUrl, signal);
    if (result.tracks.length === 0) {
      throw new MusicError(
        422,
        "playlist_empty",
        "No tracks were found at this link.",
      );
    }
    const items: PlaylistContent[] = result.tracks.map((track) => ({
      title: `${track.artists.join(", ")} — ${track.title}`,
      source: musicSource(track),
    }));
    const trimmedTitle = result.title.trim();
    return {
      title: trimmedTitle === "" ? "Imported playlist" : trimmedTitle,
      items,
      warning: result.warning,
      provider: "spotify",
    };
  }
  if (isLikelyPlaylist(url)) {
    if (deps.expandPlaylistWithMetadata === undefined) {
      throw new Error("Playlist metadata expansion is not wired");
    }
    const metadata = await deps.expandPlaylistWithMetadata(url, signal);
    if (metadata.items.length === 0) {
      throw new MusicError(
        422,
        "playlist_empty",
        "No playable videos were found in this playlist.",
      );
    }
    const items: PlaylistContent[] = metadata.items.map((item) => ({
      title: item.title,
      source: { kind: "url", url: item.url, title: item.title },
    }));
    const trimmedTitle = metadata.title?.trim() ?? "";
    return {
      title: trimmedTitle === "" ? "Imported playlist" : trimmedTitle,
      items,
      warning: "",
      provider: "youtube",
    };
  }
  throw new MusicError(
    400,
    "playlist_import_link",
    "Use a public Spotify playlist/album link or a YouTube playlist link.",
  );
}
