import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

/** How much of a game its stored canonical match document covers. */
export type StoredMatchCoverage = "complete" | "end_of_game";

/** The stored reads the review's start condition needs, replaceable in tests. */
export type ReviewableMatchReads = {
  /**
   * The coverage of the game's archived canonical match document, from Riot
   * or the client, or null when none is archived. An end-of-game record is
   * archived only after `resolveCanonicalMatch` froze it (its deadline passed
   * with no history bundle), so an archived end-of-game record is final.
   */
  readonly storedMatchCoverage: (
    matchId: RiotMatchId,
  ) => Promise<StoredMatchCoverage | null>;
  /** The Riot accounts the resolved result names, or null when none resolved. */
  readonly resultParticipants: (
    matchId: RiotMatchId,
  ) => Promise<readonly string[] | null>;
};

/**
 * The accounts that played a game the review can read, or null when it cannot
 * be read yet. The start condition is an archived canonical match document of
 * either coverage:
 *
 * - a complete document, whether Riot published it or the League client
 *   recorded it (ARAM Mayhem, custom lobbies, bot games and any other game
 *   Riot never publishes), which `review_match` reviews with its timeline;
 * - a frozen end-of-game record (League Classic without match history, and
 *   any other game the client recorded only at its end), which `review_match`
 *   reviews from the end-of-game stats and the owner's own recording, with no
 *   timeline.
 *
 * An end-of-game record still inside its deadline is not archived, so the
 * review waits for it to freeze; a history bundle arriving in that window
 * becomes the complete document instead, and is what gets reviewed. Result
 * evidence alone is not a document the review can read.
 */
export async function reviewableMatchParticipants(
  reads: ReviewableMatchReads,
  matchId: RiotMatchId,
): Promise<readonly string[] | null> {
  const coverage = await reads.storedMatchCoverage(matchId);
  return coverage === null ? null : await reads.resultParticipants(matchId);
}
