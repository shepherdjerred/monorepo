import {
  MatchIdSchema,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { evaluateHallMatch } from "#src/progression/hall/evaluate-match.ts";
import {
  launchPreparedChallengeRuns,
  prepareChallengeRunsForMatch,
  queuePreparedChallengeRuns,
  type PreparedChallengeRun,
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
  const preparedByRun = new Map<string, PreparedChallengeRun>();
  async function prepareCurrentRuns(): Promise<
    readonly PreparedChallengeRun[]
  > {
    const prepared = await prepareChallengeRunsForMatch(
      input.match,
      configuration.environment,
    );
    for (const revision of prepared) {
      preparedByRun.set(revision.runId, revision);
    }
    return prepared;
  }
  let timelinePersisted = false;
  async function ensureChallengeTimeline(): Promise<void> {
    if (timelinePersisted) return;
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
    timelinePersisted = true;
  }

  await evaluateHallMatch(input.match);
  const initiallyPrepared = await prepareCurrentRuns();
  if (initiallyPrepared.some((revision) => revision.timelineRequired)) {
    await ensureChallengeTimeline();
  }
  // Catch a run start or account edit that committed while evidence was being
  // staged. Preparing a match revision supersedes its independently launched
  // recompute, and waiting revisions are invisible to reconciliation until the
  // required timeline is durable.
  const rediscovered = await prepareCurrentRuns();
  if (rediscovered.some((revision) => revision.timelineRequired)) {
    await ensureChallengeTimeline();
  }
  const challengeRevisions = [...preparedByRun.values()];
  await queuePreparedChallengeRuns(challengeRevisions);
  await launchPreparedChallengeRuns(
    configuration.environment,
    challengeRevisions,
  );
}
