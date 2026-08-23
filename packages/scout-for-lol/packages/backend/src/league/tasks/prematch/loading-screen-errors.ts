import type { RawCurrentGameInfo } from "@scout-for-lol/data/index.ts";

/** An incomplete loading-screen payload that the poller should retry. */
export class RecoverableLoadingScreenDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoverableLoadingScreenDataError";
  }
}

export class UnsupportedLoadingScreenQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedLoadingScreenQueueError";
  }
}

export function gameInfoContextSuffix(gameInfo: RawCurrentGameInfo): string {
  return (
    `gameId=${gameInfo.gameId.toString()}, ` +
    `queueConfigId=${gameInfo.gameQueueConfigId.toString()}, ` +
    `mapId=${gameInfo.mapId.toString()}, ` +
    `gameMode=${gameInfo.gameMode}, ` +
    `gameType=${gameInfo.gameType}, ` +
    `gameLength=${gameInfo.gameLength.toString()}`
  );
}

export function buildIncompleteLobbyMessage(
  participantCount: number,
  gameInfo: RawCurrentGameInfo,
): string {
  const presentPuuids = gameInfo.participants
    .map((p) => p.puuid ?? "scrubbed")
    .join(",");
  return (
    `Standard loading screen requires exactly 10 participants; ` +
    `received ${participantCount.toString()} ` +
    `(${gameInfoContextSuffix(gameInfo)}, participants=[${presentPuuids}])`
  );
}

export function buildLopsidedTeamMessage(
  team: string,
  received: number,
  gameInfo: RawCurrentGameInfo,
): string {
  return (
    `Standard loading screen requires exactly 5 ${team} participants; ` +
    `received ${received.toString()} ` +
    `(${gameInfoContextSuffix(gameInfo)})`
  );
}
