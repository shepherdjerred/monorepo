import type { RawCurrentGameInfo } from "@scout-for-lol/data/index.ts";

/**
 * A loading-screen payload that is incomplete rather than wrong.
 *
 * The prematch poller treats this as "try again next tick" instead of an
 * error worth reporting: Riot surfaces a game during its pre-game countdown,
 * before every player has loaded in, so a partial roster is an expected
 * intermediate state rather than a bug.
 */
export class RecoverableLoadingScreenDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoverableLoadingScreenDataError";
  }
}

function gameInfoContextSuffix(gameInfo: RawCurrentGameInfo): string {
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
  participants: readonly unknown[],
  gameInfo: RawCurrentGameInfo,
): string {
  const presentPuuids = gameInfo.participants
    .map((p) => p.puuid ?? "scrubbed")
    .join(",");
  return (
    `Standard loading screen requires exactly 10 participants; ` +
    `received ${participants.length.toString()} ` +
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
