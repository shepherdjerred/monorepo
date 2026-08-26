import type {
  LoadingScreenData,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data";

export type StartParlayGenerationInput = {
  gameInfo: RawCurrentGameInfo;
  trackedPlayers: readonly PlayerConfigEntry[];
  queueType: QueueType | undefined;
  loadingScreenData: LoadingScreenData | undefined;
};
