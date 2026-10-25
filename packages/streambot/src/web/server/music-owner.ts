import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import type { WebPlayback } from "./playback.ts";
import type { WebSession } from "./session-store.ts";

export type MusicFeature = "catalog" | "spotify" | "playlists";
export type MusicPlaylistOrigin = { playlistId: string; revision: number };
export type MusicSelection = {
  sources: readonly Source[];
  feature: MusicFeature;
  origin?: MusicPlaylistOrigin;
};
export type WebMusicOwner = {
  playback: WebPlayback;
  service: () => MusicService;
  require: (
    session: WebSession,
    guildId: string,
    feature: MusicFeature,
  ) => Promise<void>;
  add: (
    session: WebSession,
    guildId: string,
    sources: readonly Source[],
    feature?: MusicFeature | MusicPlaylistOrigin,
  ) => string;
  get: (session: WebSession, guildId: string, id: string) => MusicSelection;
};
