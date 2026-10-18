import { riotWithholdsMatchResult } from "@scout-for-lol/data";

export const LOCAL_CANONICAL_DELAY_MS = 2 * 60 * 1000;

/** Client evidence waits for Riot unless the game is known to withhold results. */
export function clientEvidenceReadyAt(
  game: { queueId: number; gameMode: string; gameType: string },
  receivedAt: Date,
): Date {
  return new Date(
    receivedAt.getTime() +
      (riotWithholdsMatchResult(game) ? 0 : LOCAL_CANONICAL_DELAY_MS),
  );
}
