import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import type { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type {
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";

export type PlaybackCommandServiceDeps = {
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
