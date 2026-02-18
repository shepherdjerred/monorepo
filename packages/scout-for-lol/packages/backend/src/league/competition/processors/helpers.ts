import type {
  CompetitionQueueType,
  QueueType,
  RawMatch,
  RawParticipant,
} from "@scout-for-lol/data";
import { parseQueueType } from "@scout-for-lol/data";
import type { PlayerWithAccounts } from "@scout-for-lol/backend/league/competition/processors/types.ts";

/**
 * Check if a player participated in a match based on their account PUUIDs
 */
export function isPlayerInMatch(
  player: PlayerWithAccounts,
  match: RawMatch,
): boolean {
  const playerPuuids = new Set(player.accounts.map((account) => account.puuid));
  return match.metadata.participants.some((puuid) =>
    playerPuuids.has(puuid),
  );
}

/**
 * Check if a match belongs to the specified queue type
 */
export function matchesQueue(
  match: RawMatch,
  queueFilter: CompetitionQueueType,
): boolean {
  const queueType = parseQueueType(match.info.queueId);

  // Handle special queue filters
  if (queueFilter === "RANKED_ANY") {
    return queueType === "solo" || queueType === "flex";
  }

  if (queueFilter === "ALL") {
    return true;
  }

  // Map CompetitionQueueType to QueueType
  // Note: RANKED_ANY and ALL are handled by special cases above
  const queueMap: Partial<Record<CompetitionQueueType, QueueType>> = {
    SOLO: "solo",
    FLEX: "flex",
    ARENA: "arena",
    ARAM: "aram",
    URF: "urf",
    ARURF: "arurf",
    QUICKPLAY: "quickplay",
    SWIFTPLAY: "swiftplay",
    BRAWL: "brawl",
    DRAFT_PICK: "draft pick",
    CUSTOM: "custom",
  };

  const expectedQueue = queueMap[queueFilter];
  return expectedQueue !== undefined && queueType === expectedQueue;
}

/**
 * Get the participant data for a player in a match
 * Returns undefined if player not found
 */
export function getPlayerParticipant(
  player: PlayerWithAccounts,
  match: RawMatch,
): RawParticipant | undefined {
  const playerPuuids = new Set(player.accounts.map((account) => account.puuid));
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
