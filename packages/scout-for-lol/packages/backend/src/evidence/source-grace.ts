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

/**
 * When an end-of-game record may freeze: its deadline after upload, so the
 * game's history bundle and pending aliases can still arrive, and never
 * before Riot's first refusal. The dispatcher's `readyAt` and the resolver's
 * eligibility both read this, so the match starts exactly when it can
 * freeze.
 */
export function endOfGameEvidenceReadyAt(
  game: { queueId: number; gameMode: string; gameType: string },
  receivedAt: Date,
  deadlineMs: number,
): Date {
  return new Date(
    Math.max(
      clientEvidenceReadyAt(game, receivedAt).getTime(),
      receivedAt.getTime() + deadlineMs,
    ),
  );
}
