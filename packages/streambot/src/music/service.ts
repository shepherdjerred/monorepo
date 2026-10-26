import type { MusicTrack } from "./contracts.ts";
import type { MusicCatalog } from "./catalog.ts";
import type { SpotifyMetadata } from "./spotify.ts";
import { rankMusicMatches } from "./matching.ts";
import { QueueLoads } from "./queue-loads.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { YtdlpSearchResult } from "@shepherdjerred/streambot/sources/youtube-search-result.ts";

export function musicSource(track: MusicTrack, youtubeUrl?: string): Source {
  return youtubeUrl === undefined
    ? {
        kind: "search",
        query: [...track.artists, track.title, track.version ?? ""]
          .join(" ")
          .trim(),
        mode: "music",
        music: track,
      }
    : { kind: "url", url: youtubeUrl, mode: "music", music: track };
}

export class MusicService {
  readonly loads = new QueueLoads();
  constructor(
    readonly catalog: MusicCatalog,
    readonly spotify: SpotifyMetadata,
    private readonly searchYoutube: (
      query: string,
      signal: AbortSignal,
      limit: number,
    ) => Promise<readonly YtdlpSearchResult[]>,
  ) {}
  async matches(track: MusicTrack, signal: AbortSignal) {
    return rankMusicMatches(
      track,
      await this.searchYoutube(
        [...track.artists, track.title, track.version ?? ""].join(" "),
        signal,
        10,
      ),
    );
  }
}
