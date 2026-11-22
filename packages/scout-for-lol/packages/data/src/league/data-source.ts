import type { MatchDataSource } from "@scout-for-lol/domain/match-processing/states.ts";
import type { MatchCoverage } from "#src/model/reports/lake-columns.ts";

/** `metadata.dataVersion` of every match and timeline built from client data. */
export const SCOUT_CLIENT_DATA_VERSION = "local-1";

/**
 * `metadata.dataVersion` of a match Scout built from the League client's
 * end-of-game block alone, when the client served no match history for the
 * game. It is not a Match-V5 document: what the block does not state is
 * `null` (see `EndOfGameMatchSchema`).
 */
export const SCOUT_CLIENT_END_OF_GAME_DATA_VERSION = "local-eog-1";

/**
 * `metadata.dataVersion` of a match Scout built from the League client's own
 * match history alone, for a game the Scout Client did not witness and Riot
 * does not publish. It is not a Match-V5 document: what the history row does
 * not state is `null` (see `HistoryMatchSchema`).
 */
export const SCOUT_CLIENT_HISTORY_DATA_VERSION = "local-history-1";

/**
 * Where a Match-V5 match or timeline came from.
 *
 * A match the Scout Client captured is converted from the League client's own
 * data into Riot's shapes, and every consumer reads it exactly as it reads a
 * Riot one. Provenance is the one difference, and it is carried by the bytes
 * themselves: the converters stamp `metadata.dataVersion` with
 * {@link SCOUT_CLIENT_DATA_VERSION},
 * {@link SCOUT_CLIENT_END_OF_GAME_DATA_VERSION} or
 * {@link SCOUT_CLIENT_HISTORY_DATA_VERSION}, which no Riot payload uses
 * (Riot's is `"2"`). Deriving the source from the stored object keeps S3, the
 * lake, and anything rebuilt from them in agreement with the
 * `matchDataSource` each observation records, with nothing to drift.
 */
export function matchDataSourceOf(metadata: {
  readonly dataVersion: string;
}): MatchDataSource {
  return metadata.dataVersion === SCOUT_CLIENT_DATA_VERSION ||
    metadata.dataVersion === SCOUT_CLIENT_END_OF_GAME_DATA_VERSION ||
    metadata.dataVersion === SCOUT_CLIENT_HISTORY_DATA_VERSION
    ? "SCOUT_CLIENT"
    : "RIOT";
}

/**
 * How much of a game a stored match states: a whole Match-V5 document, the
 * end-of-game record, or the history record, whose unknowns are `null`.
 * Carried by the bytes, like {@link matchDataSourceOf}.
 */
export function matchCoverageOf(metadata: {
  readonly dataVersion: string;
}): MatchCoverage {
  if (metadata.dataVersion === SCOUT_CLIENT_END_OF_GAME_DATA_VERSION)
    return "end_of_game";
  return metadata.dataVersion === SCOUT_CLIENT_HISTORY_DATA_VERSION
    ? "history"
    : "complete";
}
