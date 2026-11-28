import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { LaneResultReadRow } from "#src/report-lake/lane-results/lane-result-columns.ts";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { readLaneResultsOnPage } from "#src/reports/duckdb/consumer/pages/lane-results-page-reads.ts";
import { listParam } from "#src/reports/duckdb/lake.ts";
import {
  addAheadAt15,
  emptyAheadAt15,
  type AheadAt15,
} from "#src/reports/lanes/ahead-at-15.ts";

/**
 * "Ahead at 15 minutes in 11 of 19 lane games" over the games the summary
 * covers. `unavailable` while the published lake predates `lane_results`.
 */
export type ProfileLane =
  { status: "unavailable" } | ({ status: "available" } & AheadAt15);

/** A match counts once however many of the player's accounts were in it. */
export function tallyProfileLane(
  rows: readonly LaneResultReadRow[],
): AheadAt15 {
  const tally = emptyAheadAt15();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.match_id)) continue;
    seen.add(row.match_id);
    addAheadAt15(tally, row);
  }
  return tally;
}

/**
 * The player's lane results in `matchIds`, on the profile's own lake page.
 * Games that ended before 15:00 (or hold no checkpoint) are not counted.
 */
export async function readProfileLane(
  page: LakePage,
  options: { puuids: readonly string[]; matchIds: readonly RiotMatchId[] },
): Promise<ProfileLane> {
  const read = await readLaneResultsOnPage(page, {
    sql: "puuid IN (SELECT unnest(?)) AND match_id IN (SELECT unnest(?))",
    params: [listParam([...options.puuids]), listParam([...options.matchIds])],
  });
  return read.status === "unavailable"
    ? read
    : { status: "available", ...tallyProfileLane(read.rows) };
}
