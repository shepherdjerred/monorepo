import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { PlaylistItem } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import type { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { SportsCatalog } from "@shepherdjerred/streambot/sports/types.ts";
import type { MusicService } from "@shepherdjerred/streambot/music/service.ts";
import type { LolPlaybackSchedules } from "@shepherdjerred/streambot/sports/playback-schedules.ts";
export type CommandBotDeps = {
  readonly music?: MusicService;
  readonly userbotIds?: () => ReadonlySet<string>;
  readonly getSchedules?: () => LolPlaybackSchedules | undefined;
  readonly config: Config;
  /** Lazily resolves the session manager (constructed after the bot to break the wiring cycle). */
  readonly getSessions: () => SessionManager;
  readonly library: () => readonly LibraryEntry[];
  readonly expandPlaylist: (
    url: string,
    signal: AbortSignal,
    progress?: (count: number) => void,
  ) => Promise<PlaylistItem[]>;
  readonly listSources: (signal: AbortSignal) => Promise<readonly string[]>;
  /** Synchronously pre-resolve a `/stream play` url/search source before acking (feature: fast error surfacing). */
  readonly resolvePlaySource: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  readonly discovery?: DiscoveryService;
  readonly history?: MediaHistoryStore;
  readonly featureGate?: MediaFeatureGate;
  readonly sports?: SportsCatalog;
};
