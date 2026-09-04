import {
  LeaguePuuidSchema,
  MatchIdSchema,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { evaluateHallMatch } from "#src/progression/hall/evaluate-match.ts";
import {
  challengeMatchNeedsTimeline,
  updateChallengeRunsForMatch,
} from "#src/progression/challenges/postmatch.ts";
import {
  fetchTimelineForProgression,
  persistTimelineForProgression,
} from "#src/league/tasks/postmatch/match-report-standard.ts";

/**
 * Last durable progression hook before account match cursors advance. Callers
 * must supply any timeline whose persistence was required by an active run.
 */
export async function processCompetitiveProgressionMatch(input: {
  readonly match: RawMatch;
  readonly timeline: RawTimeline | null | undefined;
  readonly trackedPlayers: PlayerConfigEntry[];
}): Promise<void> {
  const participantPuuids = input.match.metadata.participants.map((puuid) =>
    LeaguePuuidSchema.parse(puuid),
  );
  const needsChallengeTimeline =
    await challengeMatchNeedsTimeline(participantPuuids);
  if (
    needsChallengeTimeline &&
    (input.timeline === null || input.timeline === undefined)
  ) {
    await fetchTimelineForProgression(
      input.match,
      MatchIdSchema.parse(input.match.metadata.matchId),
      input.trackedPlayers,
    );
  } else if (
    needsChallengeTimeline &&
    input.timeline !== undefined &&
    input.timeline !== null
  ) {
    await persistTimelineForProgression(
      input.timeline,
      input.trackedPlayers,
      MatchIdSchema.parse(input.match.metadata.matchId),
    );
  }
  await evaluateHallMatch(input.match);
  await updateChallengeRunsForMatch(input.match, configuration.environment);
}
