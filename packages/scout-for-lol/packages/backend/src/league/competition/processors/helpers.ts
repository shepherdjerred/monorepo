import {
  resolveQueueTypeFromGame,
  isClassicQueueType,
  type CompetitionQueueType,
  type CompetitionGameVariant,
  type CanonicalMatch,
  type CanonicalParticipant,
  canonicalMatchTournamentCode,
} from "@scout-for-lol/data";
import type { PlayerWithAccounts } from "#src/league/competition/processors/types.ts";

/**
 * Check if a player participated in a match based on their account PUUIDs
 */
export function isPlayerInMatch(
  player: PlayerWithAccounts,
  match: CanonicalMatch,
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
  match: CanonicalMatch,
  queueFilters: readonly CompetitionQueueType[],
  gameVariant: CompetitionGameVariant,
): boolean {
  const queueType = resolveQueueTypeFromGame(
    match.info.queueId,
    match.info.gameMode,
    match.info.gameType,
    canonicalMatchTournamentCode(match),
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
  match: CanonicalMatch,
): CanonicalParticipant | undefined {
  const playerPuuids = new Set<string>(
    player.accounts.map((account) => account.puuid),
  );
  return match.info.participants.find(
    (participant) =>
      participant.puuid !== null && playerPuuids.has(participant.puuid),
  );
}

/**
 * Check if a participant won the match
 */
export function isWin(participant: CanonicalParticipant): boolean {
  return participant.win;
}
