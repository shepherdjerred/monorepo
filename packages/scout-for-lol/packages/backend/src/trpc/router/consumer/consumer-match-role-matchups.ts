import { LANE_ORDER, parseLane, type Lane } from "@scout-for-lol/data";
import type {
  LakeMatchParticipantRow,
  LakeTimelineCoverage,
  LaneDeltaFrame,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import { isStandardRiftGame } from "#src/trpc/router/consumer/standard-rift.ts";

export const LANE_DELTA_MINUTE = 15;
const LANE_DELTA_TIMESTAMP_MS = LANE_DELTA_MINUTE * 60_000;

export type RoleMatchup = {
  role: Lane;
  blueParticipantId: number;
  redParticipantId: number;
  at15: {
    timestampMs: number;
    goldDelta: number;
    creepScoreDelta: number;
    xpDelta: number;
  } | null;
};

/** A role pairing needs timeline frames, which are keyed by participant id. */
function requiredParticipantId(row: LakeMatchParticipantRow): number {
  if (row.participant_id === null) {
    throw new Error(
      `Role matchup row for ${row.match_id} has no participant id`,
    );
  }
  return row.participant_id;
}

function uniqueRoleParticipant(
  rows: LakeMatchParticipantRow[],
  teamId: number,
  role: Lane,
): LakeMatchParticipantRow | null {
  const candidates = rows.filter(
    (row) => row.team_id === teamId && parseLane(row.team_position) === role,
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

export function buildRoleMatchups(options: {
  rows: LakeMatchParticipantRow[];
  coverage: LakeTimelineCoverage | null;
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
  const hasAt15 =
    options.coverage?.last_frame_timestamp_ms !== null &&
    options.coverage?.last_frame_timestamp_ms !== undefined &&
    options.coverage.last_frame_timestamp_ms >= LANE_DELTA_TIMESTAMP_MS;
  const framesByParticipant = new Map(
    options.frames.map((frame) => [frame.participant_id, frame] as const),
  );
  return LANE_ORDER.map((role) => {
    const blueParticipant = uniqueRoleParticipant(options.rows, 100, role);
    const redParticipant = uniqueRoleParticipant(options.rows, 200, role);
    if (blueParticipant === null || redParticipant === null) {
      return null;
    }
    if (!hasAt15) {
      return {
        role,
        blueParticipantId: requiredParticipantId(blueParticipant),
        redParticipantId: requiredParticipantId(redParticipant),
        at15: null,
      };
    }
    const blueFrame = framesByParticipant.get(
      requiredParticipantId(blueParticipant),
    );
    const redFrame = framesByParticipant.get(
      requiredParticipantId(redParticipant),
    );
    if (blueFrame === undefined || redFrame === undefined) {
      throw new Error(
        `Complete timeline for ${blueParticipant.match_id} is missing a 15-minute lane frame`,
      );
    }
    return {
      role,
      blueParticipantId: requiredParticipantId(blueParticipant),
      redParticipantId: requiredParticipantId(redParticipant),
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
