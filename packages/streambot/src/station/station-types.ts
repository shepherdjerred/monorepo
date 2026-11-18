import type { MediaMode } from "@shepherdjerred/streambot/sources/media-kind.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { PersistedStation } from "@shepherdjerred/streambot/state/station-schema.ts";
import type {
  ChannelId,
  GuildId,
  UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { PlaybackChannelNumber } from "@shepherdjerred/streambot/types/playback-channel.ts";

export type CuratedStationItem = {
  readonly source: Source;
  readonly title: string;
  readonly thumbnailUrl?: string;
  readonly channel?: string;
  readonly durationSeconds?: number;
};

export type StationCurationContext = {
  readonly guildId: GuildId;
  readonly channelId: ChannelId;
  readonly playbackChannel?: PlaybackChannelNumber | undefined;
  readonly station: PersistedStation;
  readonly listenerIds: readonly UserId[];
  readonly excludeIdentities: ReadonlySet<string>;
  readonly excludeWorkKeys: ReadonlySet<string>;
  readonly count: number;
  readonly mode: MediaMode | undefined;
  readonly signal: AbortSignal;
};

export type StationCurator = {
  curate: (
    context: StationCurationContext,
  ) => Promise<readonly CuratedStationItem[]>;
};

export type StationCuratorRegistry = {
  readonly radio?: StationCurator;
  readonly tv?: StationCurator;
};
