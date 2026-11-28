import type { LaneResultReadRow } from "#src/report-lake/lane-results/lane-result-columns.ts";

/** How one laner stood against their opponent at the 15:00 checkpoint. */
export type LaneStanding = "ahead" | "even" | "behind";

/**
 * Games ahead of games with a checkpoint. A game with no checkpoint (it ended
 * before 15:00, has no timeline, or its 15:00 frame omits a participant) is in
 * neither number.
 */
export type AheadAt15 = { games: number; ahead: number };

/**
 * The one definition of "ahead at 15 minutes" the pages read from
 * `lane_results`: the laner's gold strictly greater than the same-role
 * opponent's at the checkpoint. `null` when the row states no checkpoint
 * difference.
 */
export function laneStanding(
  row: Pick<LaneResultReadRow, "gold_diff_at_15">,
): LaneStanding | null {
  if (row.gold_diff_at_15 === null) return null;
  if (row.gold_diff_at_15 > 0) return "ahead";
  return row.gold_diff_at_15 === 0 ? "even" : "behind";
}

export function emptyAheadAt15(): AheadAt15 {
  return { games: 0, ahead: 0 };
}

export function addAheadAt15(
  tally: AheadAt15,
  row: Pick<LaneResultReadRow, "gold_diff_at_15">,
): void {
  const standing = laneStanding(row);
  if (standing === null) return;
  tally.games += 1;
  if (standing === "ahead") tally.ahead += 1;
}
