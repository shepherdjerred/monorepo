import { classifyGame } from "@scout-for-lol/data";

const STANDARD_RIFT_QUEUE_IDS = new Set([
  400, // Normal Draft
  420, // Ranked Solo/Duo
  430, // Normal Blind
  440, // Ranked Flex
  480, // Swiftplay
  490, // Quickplay
  700, // Clash
  710, // Ranked Teams
]);

/**
 * A user-created lobby or tournament game, classified from the stored ids
 * rather than the stored `queue`, which older lake rows leave empty.
 */
function isLobbyQueue(match: {
  queue_id: number;
  game_mode: string;
  game_type?: string;
}): boolean {
  const classification = classifyGame({
    queueId: match.queue_id,
    gameMode: match.game_mode,
    gameType: match.game_type,
  });
  return (
    classification.kind === "queue" &&
    (classification.queue === "custom" || classification.queue === "tournament")
  );
}

/** Only ordinary Summoner's Rift queues have meaningful lane opponents. */
export function isStandardRiftGame(match: {
  queue: string | null;
  queue_id: number;
  game_mode: string;
  game_type?: string;
  map_id: number;
}): boolean {
  return (
    match.map_id === 11 &&
    match.game_mode === "CLASSIC" &&
    (STANDARD_RIFT_QUEUE_IDS.has(match.queue_id) || isLobbyQueue(match))
  );
}
