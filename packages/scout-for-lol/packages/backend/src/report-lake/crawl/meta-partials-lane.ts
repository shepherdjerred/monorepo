/**
 * The lane partials: how often a champion has more gold than its same-role
 * opponent at the 15:00 checkpoint.
 *
 * The rule is the app's (`buildRoleMatchups`) and lives nowhere else:
 *
 * - The checkpoint is the crawl's 15:00 row of `timeline_checkpoints_crawl`:
 *   the first frame stamped at or after 15:00 and before 16:00. A game with no
 *   such frame (a game under 15 minutes, a match whose timeline was not
 *   sampled, a segment written before the crawl kept checkpoints) has no
 *   checkpoint, so it is a game in `champion` and `matchup` but is not a lane
 *   game: it is absent from the lane figure rather than counted as not ahead.
 * - Ahead means the champion's total gold is strictly greater than the
 *   opponent's. A tie is not ahead for either side.
 * - Only a match with ten complete participants and exactly one player per
 *   team and role is paired, as `buildRoleMatchups` pairs only such matches.
 *
 * `lane` rows are per (champion, role): `games` is the lane games and `wins`
 * the games ahead. `lane_matchup` rows add the opponent in `key1`, with the
 * same two counts. Checkpoint rows are joined through the day's `matches_crawl`
 * participants, so an erased match has no lane rows once the day's crawl files
 * are rewritten and the partials re-derived.
 */

/** 15:00 in match milliseconds, one of the crawl's `CHECKPOINT_TIMES_MS`. */
export const LANE_CHECKPOINT_MS = 900_000;

export const CHECKPOINT_COLUMNS =
  "match_id VARCHAR, participant_id INTEGER, checkpoint_ms INTEGER, frame_timestamp_ms INTEGER, total_gold INTEGER";

export const CHECKPOINT_SELECT =
  "SELECT match_id, participant_id, checkpoint_ms, frame_timestamp_ms, total_gold FROM read_parquet($1, hive_partitioning = false)";

export const LANE_PREPARE_SQL = [
  `CREATE OR REPLACE TEMP TABLE meta_cp AS
   SELECT match_id, participant_id, total_gold FROM meta_cp_raw
   WHERE checkpoint_ms = ${LANE_CHECKPOINT_MS.toString()}
   QUALIFY row_number() OVER (PARTITION BY match_id, participant_id ORDER BY frame_timestamp_ms) = 1`,
  `CREATE OR REPLACE TEMP TABLE meta_lane_matches AS
   SELECT match_id FROM meta_p GROUP BY match_id
   HAVING count(*) = 10 AND count(DISTINCT CAST(team_id AS VARCHAR) || ':' || role) = 10`,
  `CREATE OR REPLACE TEMP TABLE meta_lane AS
   SELECT a.patch, a.queue_id, a.tier, a.role, a.champion_id, b.champion_id AS opponent_id,
     CAST(ca.total_gold > cb.total_gold AS INTEGER) AS ahead
   FROM meta_p a
   JOIN meta_lane_matches m ON m.match_id = a.match_id
   JOIN meta_p b ON b.match_id = a.match_id AND b.role = a.role AND b.team_id <> a.team_id
   JOIN meta_cp ca ON ca.match_id = a.match_id AND ca.participant_id = a.participant_id
   JOIN meta_cp cb ON cb.match_id = b.match_id AND cb.participant_id = b.participant_id`,
];

/** Every query yields the partial columns in order. */
export function lanePartialQueries(): string[] {
  return [
    `SELECT 'lane', patch, queue_id, tier, role, champion_id, '', '', count(*), sum(ahead)
     FROM meta_lane GROUP BY patch, queue_id, tier, role, champion_id`,
    // A mirror match has no opponent champion to report, as in `matchup`.
    `SELECT 'lane_matchup', patch, queue_id, tier, role, champion_id, CAST(opponent_id AS VARCHAR), '', count(*), sum(ahead)
     FROM meta_lane WHERE opponent_id <> champion_id
     GROUP BY patch, queue_id, tier, role, champion_id, opponent_id`,
  ];
}
