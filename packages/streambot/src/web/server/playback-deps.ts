import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { NumberedSessions } from "@shepherdjerred/streambot/session/numbered-sessions.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { WebDiscordContext } from "@shepherdjerred/streambot/discord/web-context.ts";
import type { ChannelId } from "@shepherdjerred/streambot/types/ids.ts";
import type { WebCatalog } from "./catalog.ts";

export type WebPlaybackDeps = {
  sessions: Pick<
    SessionManager,
    "getExisting" | "ensureForPlay" | "releaseUnused" | "revision"
  > & {
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
