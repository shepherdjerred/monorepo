import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { SportsCatalog } from "@shepherdjerred/streambot/sports/types.ts";
import type { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type {
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { PlaybackChannelNumber } from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

export type PlaybackCommandServiceDeps = {
  readonly preparePlayback?: () => void;
  readonly routePlayback?: (
    source: Source,
    resolved: ResolvedSource | undefined,
    userId: UserId,
  ) => Promise<PlaybackCommandServiceDeps>;
  readonly resetChannel?: (userId: string) => Promise<string>;
  readonly playbackChannel?: PlaybackChannelNumber;
  readonly selectChannel?: (userId: string, number: number) => Promise<string>;
  readonly listChannels?: (userId: string) => Promise<string>;
  readonly leaveRoom?: () => void;
  /** Supplied only by a transport that has independently verified channel authority. */
  readonly authorization?: {
    readonly controlItem: (
      userId: UserId,
      requesterId: UserId | null,
    ) => boolean;
    readonly manageQueue: (userId: UserId) => boolean;
  };
  /** Recheck an optimistic transport revision after asynchronous media resolution. */
  readonly assertCurrent?: () => void;
  readonly config: Pick<Config, "discord">;
  readonly dispatch: (event: PlaybackEvent) => void;
  readonly view: () => PlaybackView;
  readonly library: () => readonly LibraryEntry[];
  readonly setVolume: (percent: number) => Promise<boolean>;
  readonly seek: (seconds: number) => Promise<boolean>;
  readonly resolvePlaySource: (
    source: Source,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  readonly announce: (message: string) => Promise<void>;
  readonly discovery?: DiscoveryService;
  readonly history?: MediaHistoryStore;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly featureGate?: MediaFeatureGate;
  readonly sports?: SportsCatalog;
};

export type PlaybackCommandResult = {
  readonly outcome:
    | "queued"
    | "queued-next"
    | "playing-now"
    | "joined"
    | "left"
    | "paused"
    | "resumed"
    | "restarted"
    | "skipped"
    | "stopped"
    | "seeked"
    | "volume-set"
    | "volume-deferred"
    | "loop-set"
    | "shuffled"
    | "removed"
    | "cleared"
    | "moved"
    | "chapter-jumped"
    | "subtitles-off";
  readonly message: string;
};
