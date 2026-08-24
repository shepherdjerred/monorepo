import {
  resolveQueueTypeFromGame,
  isClassicQueueType,
  type CompetitionQueueType,
  type CompetitionGameVariant,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import type { PlayerWithAccounts } from "#src/league/competition/processors/types.ts";

/**
 * Check if a player participated in a match based on their account PUUIDs
 */
export function isPlayerInMatch(
  player: PlayerWithAccounts,
  match: RawMatch,
): boolean {
  const playerPuuids = new Set<string>(
    player.accounts.map((account) => account.puuid),
  );
  return match.metadata.participants.some((puuid) => playerPuuids.has(puuid));
}

/**
 * Check if a match belongs to the specified queue type
 */
export function matchesQueues(
  match: RawMatch,
  queueFilters: readonly CompetitionQueueType[],
  gameVariant: CompetitionGameVariant,
): boolean {
  const queueType = resolveQueueTypeFromGame(
    match.info.queueId,
    match.info.gameMode,
    match.info.gameType,
  );

  if (queueType === undefined) {
    return false;
  }
  if (queueFilters.includes("ALL")) {
    return gameVariant === "CLASSIC"
      ? isClassicQueueType(queueType)
      : !isClassicQueueType(queueType);
  }
  return queueFilters.includes(queueType);
}

/**
 * Get the participant data for a player in a match
 * Returns undefined if player not found
 */
export function getPlayerParticipant(
  player: PlayerWithAccounts,
  match: RawMatch,
): RawParticipant | undefined {
  const playerPuuids = new Set<string>(
    player.accounts.map((account) => account.puuid),
  );
  return match.info.participants.find((participant) =>
    playerPuuids.has(participant.puuid),
  );
}

/**
 * Check if a participant won the match
 */
export function isWin(participant: RawParticipant): boolean {
  return participant.win;
}
