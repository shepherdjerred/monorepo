import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { NumberedSessions } from "@shepherdjerred/streambot/session/numbered-sessions.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { WebDiscordContext } from "@shepherdjerred/streambot/discord/web-context.ts";
import type { ChannelId } from "@shepherdjerred/streambot/types/ids.ts";
import type { WebCatalog } from "./catalog.ts";
import type { LolPlaybackSchedules } from "@shepherdjerred/streambot/sports/playback-schedules.ts";
import type { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import type { MusicSearchProviders } from "@shepherdjerred/streambot/music/search-provider.ts";

export type WebPlaybackDeps = {
  schedules?: LolPlaybackSchedules;
  music?: MusicService;
  /** Providers behind music search in the unified `/api/search/v2` endpoints. */
  musicSearch?: MusicSearchProviders;
  expandPlaylist?: (
    url: string,
    signal: AbortSignal,
    progress?: (count: number) => void,
  ) => Promise<readonly { title: string; url: string }[]>;
  expandPlaylistWithMetadata?: (
    url: string,
    signal: AbortSignal,
  ) => Promise<{
    title: string | undefined;
    items: readonly { title: string; url: string }[];
  }>;
  sessions: Pick<
    SessionManager,
    "getExisting" | "ensureForPlay" | "releaseUnused" | "revision" | "changes"
  > & {
    startStation?: SessionManager["startStation"];
    stopStation?: SessionManager["stopStation"];
    numbered: Pick<NumberedSessions, "selected" | "selection" | "maximum">;
  };
  bot: Pick<
    WebDiscordContext,
    "webGuilds" | "webVerifyMember" | "webVoiceChannel" | "webReady"
  > & {
    webRequesterName?: (guildId: string, userId: string) => Promise<string>;
  };
  commands: Omit<
    PlaybackCommandServiceDeps,
    | "dispatch"
    | "view"
    | "setVolume"
    | "seek"
    | "guildId"
    | "channelId"
    | "authorization"
    | "assertCurrent"
    | "announce"
    | "playbackChannel"
  >;
  announce: (channelId: ChannelId, message: string) => Promise<void>;
  featureGate: MediaFeatureGate;
  webEnabled: (guildId: string, userId: string) => Promise<boolean>;
  catalog: WebCatalog;
};
