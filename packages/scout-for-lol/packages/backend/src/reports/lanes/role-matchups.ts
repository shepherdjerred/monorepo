import { LANE_ORDER, parseLane, type Lane } from "@scout-for-lol/data";
import type {
  LakeMatchParticipantRow,
  LaneDeltaFrame,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { isStandardRiftGame } from "#src/reports/lanes/standard-rift.ts";

/** The participant columns pairing roles reads. */
export type RoleMatchupRow = Pick<
  LakeMatchParticipantRow,
  | "match_id"
  | "queue"
  | "queue_id"
  | "game_mode"
  | "game_type"
  | "map_id"
  | "participant_id"
  | "team_id"
  | "team_position"
>;

export const LANE_DELTA_MINUTE = 15;
export const LANE_DELTA_CHECKPOINT_MS = LANE_DELTA_MINUTE * 60_000;

export type RoleMatchup = {
  role: Lane;
  blueParticipantId: number;
  redParticipantId: number;
  checkpoint: RoleCheckpoint;
  /** Set only for a `complete` checkpoint. */
  at15: {
    timestampMs: number;
    goldDelta: number;
    creepScoreDelta: number;
    xpDelta: number;
  } | null;
};

/** The participant columns a role pairing reads. */
export type RoleMatchupParticipant = Pick<
  LakeMatchParticipantRow,
  | "match_id"
  | "participant_id"
  | "team_id"
  | "team_position"
  | "queue"
  | "queue_id"
  | "game_mode"
  | "game_type"
  | "map_id"
>;

/** A role pairing needs timeline frames, which are keyed by participant id. */
function requiredParticipantId(row: RoleMatchupRow): number {
  if (row.participant_id === null) {
    throw new Error(
      `Role matchup row for ${row.match_id} has no participant id`,
    );
  }
  return row.participant_id;
}

function uniqueRoleParticipant(
  rows: RoleMatchupRow[],
  teamId: number,
  role: Lane,
): RoleMatchupRow | null {
  const candidates = rows.filter(
    (row) => row.team_id === teamId && parseLane(row.team_position) === role,
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/**
 * How a match's 15:00 checkpoint stands: `missing` when no frame falls in
 * [15:00, 16:00) (the game ended first, or the frame is absent), `incomplete`
 * when that frame omits one or more participants, else `complete`.
 *
 * An incomplete frame is Riot boundary data (a timeline's `participantFrames`
 * is an open record), so it is a stated state with no lane result rather than
 * an error: one such match must not fail the match page or a lake fold.
 */
export type RoleCheckpoint = "complete" | "missing" | "incomplete";

function checkpointState(
  rows: readonly RoleMatchupParticipant[],
  framesByParticipant: ReadonlyMap<number, LaneDeltaFrame>,
): RoleCheckpoint {
  if (framesByParticipant.size === 0) return "missing";
  return rows.every((row) =>
    framesByParticipant.has(requiredParticipantId(row)),
  )
    ? "complete"
    : "incomplete";
}

/**
 * `frames` are the participants' frames at the 15:00 checkpoint
 * (`fetchTimelineCheckpointFrames`). Only a `complete` checkpoint gives the
 * pairing a lane result.
 */
export function buildRoleMatchups(options: {
  rows: RoleMatchupRow[];
  frames: LaneDeltaFrame[];
}): RoleMatchup[] | null {
  if (options.rows[0] === undefined || !isStandardRiftGame(options.rows[0])) {
    return null;
  }
  // An end-of-game record numbers no participant and has no timeline to pair.
  if (options.rows.some((row) => row.participant_id === null)) return null;
  const blue = options.rows.filter((row) => row.team_id === 100);
  const red = options.rows.filter((row) => row.team_id === 200);
  if (options.rows.length !== 10 || blue.length !== 5 || red.length !== 5) {
    return null;
  }
  const framesByParticipant = new Map(
    options.frames.map((frame) => [frame.participant_id, frame] as const),
  );
  const checkpoint = checkpointState(options.rows, framesByParticipant);
  return LANE_ORDER.map((role) => {
    const blueParticipant = uniqueRoleParticipant(options.rows, 100, role);
    const redParticipant = uniqueRoleParticipant(options.rows, 200, role);
    if (blueParticipant === null || redParticipant === null) {
      return null;
    }
    const blueParticipantId = requiredParticipantId(blueParticipant);
    const redParticipantId = requiredParticipantId(redParticipant);
    const blueFrame = framesByParticipant.get(blueParticipantId);
    const redFrame = framesByParticipant.get(redParticipantId);
    if (
      checkpoint !== "complete" ||
      blueFrame === undefined ||
      redFrame === undefined
    ) {
      return {
        role,
        blueParticipantId,
        redParticipantId,
        checkpoint,
        at15: null,
      };
    }
    return {
      role,
      blueParticipantId,
      redParticipantId,
      checkpoint,
      at15: {
        timestampMs: blueFrame.frame_timestamp_ms,
        goldDelta: blueFrame.total_gold - redFrame.total_gold,
        creepScoreDelta:
          blueFrame.minions_killed +
          blueFrame.jungle_minions_killed -
          redFrame.minions_killed -
          redFrame.jungle_minions_killed,
        xpDelta: blueFrame.xp - redFrame.xp,
      },
    };
  }).reduce<RoleMatchup[] | null>((matchups, matchup) => {
    return matchups === null || matchup === null
      ? null
      : [...matchups, matchup];
  }, []);
}
