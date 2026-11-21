import type { MusicTrack } from "@shepherdjerred/streambot/music/contracts.ts";
import type {
  MusicAlbumHit,
  MusicArtistHit,
} from "@shepherdjerred/streambot/music/search-provider.ts";
import { musicArtworkUrl } from "@shepherdjerred/streambot/music/artwork.ts";
import type {
  Row,
  RowAction,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { z } from "zod";
import type { HistoryProviderSchema } from "@shepherdjerred/streambot/history/provider.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

type SourceProvider = z.infer<typeof HistoryProviderSchema>;

/** What a viewer may do with media that offers both; `listen` needs music over voice enabled. */
export function bothActions(
  first: RowAction,
  listenAllowed: boolean,
): RowAction[] {
  if (!listenAllowed) return ["watch"];
  return first === "listen" ? ["listen", "watch"] : ["watch", "listen"];
}

export function joined(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

export function songRow(input: {
  track: MusicTrack;
  token: string;
  guildId: string;
  listenAllowed: boolean;
}): Row {
  const { track } = input;
  const artwork = musicArtworkUrl(track, input.guildId);
  return {
    id: input.token,
    kind: "song",
    title: track.title,
    subtitle: joined([track.artists.join(", "), track.album]),
    ...(track.durationSeconds === undefined
      ? {}
      : { durationSeconds: track.durationSeconds }),
    ...(artwork === undefined ? {} : { artworkUrl: artwork }),
    actions: bothActions("listen", input.listenAllowed),
  };
}

export function albumRow(album: MusicAlbumHit, guildId: string): Row {
  const artwork = musicArtworkUrl(album, guildId);
  return {
    id: album.id,
    kind: "album",
    title: album.title,
    subtitle: joined([album.artists.join(", "), album.year]),
    ...(artwork === undefined ? {} : { artworkUrl: artwork }),
    actions: [],
    browse: { kind: "album", id: album.id },
  };
}

export function artistRow(artist: MusicArtistHit): Row {
  return {
    id: artist.id,
    kind: "artist",
    title: artist.name,
    subtitle: "Artist",
    ...(artist.artworkUrl === undefined
      ? {}
      : { artworkUrl: artist.artworkUrl }),
    actions: [],
    browse: { kind: "artist", id: artist.id },
  };
}

const HISTORY_LABELS: Readonly<Record<SourceProvider, string>> = {
  local: "Library",
  youtube: "YouTube",
  url: "Link",
  streameast: "Live sports",
  tvsportslive: "Live sports",
  lolesports: "Live sports",
};

/** Replay actions follow how the item was recorded: live and library items only play as video. */
export function historyActions(input: {
  provider: SourceProvider;
  source: Source;
  replayAvailable: boolean;
  listenAllowed: boolean;
}): RowAction[] {
  if (!input.replayAvailable) return [];
  if (input.provider !== "youtube" && input.provider !== "url")
    return ["watch"];
  const music =
    input.source.music !== undefined || input.source.mode === "music";
  return bothActions(music ? "listen" : "watch", input.listenAllowed);
}

export function historyLabel(provider: SourceProvider): string {
  return HISTORY_LABELS[provider];
}

/** `https?://` text, parsed. Other text, including malformed links, is not a URL query. */
export function pastedUrl(query: string): URL | "malformed" | null {
  if (!/^https?:\/\//iu.test(query)) return null;
  try {
    return new URL(query);
  } catch {
    return "malformed";
  }
}

export function countBucket(count: number): "0" | "1-5" | "6-20" | "21+" {
  if (count === 0) return "0";
  if (count <= 5) return "1-5";
  return count <= 20 ? "6-20" : "21+";
}
