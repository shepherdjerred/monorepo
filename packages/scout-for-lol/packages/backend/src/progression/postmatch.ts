import type {
  PlayerConfigEntry,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import { evaluateHallMatch } from "#src/progression/hall/evaluate-match.ts";

/**
 * Last durable progression hook before account match cursors advance.
 */
export async function processCompetitiveProgressionMatch(input: {
  readonly match: RawMatch;
  readonly timeline: RawTimeline | null | undefined;
  readonly trackedPlayers: PlayerConfigEntry[];
}): Promise<void> {
  await evaluateHallMatch(input.match);
}
