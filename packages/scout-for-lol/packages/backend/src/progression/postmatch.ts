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
  launchPreparedChallengeRuns,
  prepareChallengeRunsForMatch,
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
  await evaluateHallMatch(input.match);
  const challengeRevisions = await prepareChallengeRunsForMatch(
    input.match,
    configuration.environment,
  );
  // A run can start or change accounts while this match is being processed.
  // Re-read the run state after match-trigger revisions are serialized, then
  // durably stage required evidence before recompute and cursor advancement.
  if (await challengeMatchNeedsTimeline(participantPuuids)) {
    const matchId = MatchIdSchema.parse(input.match.metadata.matchId);
    if (input.timeline === null || input.timeline === undefined) {
      await fetchTimelineForProgression(
        input.match,
        matchId,
        input.trackedPlayers,
      );
    } else {
      await persistTimelineForProgression(
        input.timeline,
        input.trackedPlayers,
        matchId,
      );
    }
  }
  await launchPreparedChallengeRuns(
    configuration.environment,
    challengeRevisions,
  );
}
