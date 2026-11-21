import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

/** How much of a game its stored canonical match document covers. */
export type StoredMatchCoverage = "complete" | "end_of_game";

/** The stored reads the review's start condition needs, replaceable in tests. */
export type ReviewableMatchReads = {
  /** The frozen canonical match document, from Riot or the client, if any. */
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
 * be read yet. `review_match` reads the stored match document and refuses an
 * end-of-game record, so the start condition is that a complete canonical
 * match document is stored, whether Riot published it or the League client
 * recorded it (ARAM Mayhem, custom lobbies, bot games and any other game Riot
 * never publishes). Result evidence alone, or an end-of-game record, is not
 * a document the review can read.
 */
export async function reviewableMatchParticipants(
  reads: ReviewableMatchReads,
  matchId: RiotMatchId,
): Promise<readonly string[] | null> {
  const coverage = await reads.storedMatchCoverage(matchId);
  return coverage === "complete"
    ? await reads.resultParticipants(matchId)
    : null;
}
