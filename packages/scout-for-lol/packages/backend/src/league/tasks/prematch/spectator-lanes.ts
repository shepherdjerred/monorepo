import {
  inferStandardLanesWithCurrentPriors,
  type Lane,
  type RawCurrentGameParticipant,
} from "@scout-for-lol/data";

/**
 * A lane is only believed when the best assignment beats the runner-up by more
 * than this score. Anything closer is an ambiguous lobby, and naming a lane
 * there would be a guess presented as a fact.
 */
const MIN_LANE_INFERENCE_MARGIN = 2;

/**
 * Infer each spectator participant's lane from champion and summoner spells.
 *
 * The spectator payload carries no role, so this is the only source. Keys are
 * indexes into `participants`. `null` means the lobby has no confident answer
 * (not ten players, a team that is not five, or two assignments too close to
 * call), and callers must treat that as "lane unknown" rather than choosing.
 */
export function inferSpectatorLanes(
  participants: readonly RawCurrentGameParticipant[],
): Map<number, Lane> | null {
  if (participants.length !== 10) return null;
  const result = new Map<number, Lane>();
  for (const teamId of [100, 200]) {
    const team = participants
      .map((participant, index) => ({ participant, index }))
      .filter((entry) => entry.participant.teamId === teamId);
    if (team.length !== 5) return null;
    const inferred = inferStandardLanesWithCurrentPriors(
      team.map((entry) => ({
        participantKey: `participant:${entry.index.toString()}`,
        championId: entry.participant.championId,
        spell1Id: entry.participant.spell1Id,
        spell2Id: entry.participant.spell2Id,
      })),
    );
    if (
      inferred.secondBestScore !== null &&
      inferred.bestScore - inferred.secondBestScore <= MIN_LANE_INFERENCE_MARGIN
    ) {
      return null;
    }
    for (const assignment of inferred.assignments) {
      const index = Number(
        assignment.participantKey.replace("participant:", ""),
      );
      if (!Number.isInteger(index)) return null;
      result.set(index, assignment.lane);
    }
  }
  return result;
}
