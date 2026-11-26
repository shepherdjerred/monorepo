import { lakeTimestamp } from "#src/report-lake/schema.ts";
import type { LaneResultLakeRow } from "#src/report-lake/lane-results/lane-result-columns.ts";
import type {
  LakeMatchParticipantRow,
  LaneDeltaFrame,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";
import {
  buildRoleMatchups,
  type RoleMatchup,
  type RoleMatchupParticipant,
} from "#src/trpc/router/consumer/consumer-match-role-matchups.ts";

/** The participant columns a lane result reads, beyond the pairing's. */
export type LaneParticipant = RoleMatchupParticipant &
  Pick<LakeMatchParticipantRow, "puuid" | "champion_id" | "win"> & {
    month: string;
    game_created_ms: number;
  };

type LaneSide = {
  laner: LaneParticipant;
  opponent: LaneParticipant;
  /** +1 for blue (the pairing's deltas are blue minus red), -1 for red. */
  sign: 1 | -1;
};

function participantById(
  participants: readonly LaneParticipant[],
  participantId: number,
): LaneParticipant {
  const participant = participants.find(
    (row) => row.participant_id === participantId,
  );
  if (participant === undefined) {
    throw new Error(
      `Lane pairing names participant ${participantId.toString()}, which match ${participants[0]?.match_id ?? "unknown"} does not have`,
    );
  }
  return participant;
}

function laneRow(
  matchup: RoleMatchup,
  side: LaneSide,
  context: { hasTimeline: boolean; derivedAt: string },
): LaneResultLakeRow {
  const { laner, opponent, sign } = side;
  const at15 = matchup.at15;
  const participantId = laner.participant_id;
  const opponentParticipantId = opponent.participant_id;
  if (participantId === null || opponentParticipantId === null) {
    throw new Error(`Lane pairing in ${laner.match_id} has no participant id`);
  }
  return {
    match_id: laner.match_id,
    month: laner.month,
    derived_at: context.derivedAt,
    game_created_at: lakeTimestamp(laner.game_created_ms),
    queue_id: laner.queue_id,
    puuid: laner.puuid,
    participant_id: participantId,
    team_id: laner.team_id,
    role: matchup.role,
    champion_id: laner.champion_id,
    opponent_participant_id: opponentParticipantId,
    opponent_puuid: opponent.puuid,
    opponent_champion_id: opponent.champion_id,
    win: laner.win,
    has_timeline: context.hasTimeline,
    checkpoint_timestamp_ms: at15?.timestampMs ?? null,
    // `0 * -1` is `-0`, which serializes as 0 but compares unequal under
    // Object.is; adding 0 normalizes it.
    gold_diff_at_15: at15 === null ? null : sign * at15.goldDelta + 0,
    cs_diff_at_15: at15 === null ? null : sign * at15.creepScoreDelta + 0,
    xp_diff_at_15: at15 === null ? null : sign * at15.xpDelta + 0,
  };
}

/**
 * One match's lane results: both sides of every pairing `buildRoleMatchups`
 * makes from the same rows and 15:00 checkpoint frames the match page reads,
 * so the table and the page cannot disagree about who was ahead.
 *
 * `frames` are the match's checkpoint frames (first frame stamped in
 * [15:00, 16:00)); none means the game ended first or the frame is missing.
 * A match the pairing rejects (not a standard Rift game, or roles that do not
 * pair one-to-one) has no rows.
 */
export function laneResultRows(input: {
  participants: readonly LaneParticipant[];
  frames: readonly LaneDeltaFrame[];
  hasTimeline: boolean;
  derivedAt: string;
}): LaneResultLakeRow[] {
  const matchups = buildRoleMatchups({
    rows: input.participants,
    frames: input.frames,
  });
  if (matchups === null) return [];
  const context = {
    hasTimeline: input.hasTimeline,
    derivedAt: input.derivedAt,
  };
  return matchups.flatMap((matchup) => {
    const blue = participantById(input.participants, matchup.blueParticipantId);
    const red = participantById(input.participants, matchup.redParticipantId);
    return [
      laneRow(matchup, { laner: blue, opponent: red, sign: 1 }, context),
      laneRow(matchup, { laner: red, opponent: blue, sign: -1 }, context),
    ];
  });
}
