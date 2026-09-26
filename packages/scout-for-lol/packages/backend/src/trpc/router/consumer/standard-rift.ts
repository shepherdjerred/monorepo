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

/** Only ordinary Summoner's Rift queues have meaningful lane opponents. */
export function isStandardRiftGame(match: {
  queue_id: number;
  game_mode: string;
  map_id: number;
}): boolean {
  return (
    match.map_id === 11 &&
    match.game_mode === "CLASSIC" &&
    STANDARD_RIFT_QUEUE_IDS.has(match.queue_id)
  );
}
