import { Context } from "@temporalio/activity";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";
import type { ScoutV2MatchActivities } from "#src/temporal/v2/match-activity-surface.ts";

/**
 * The Activities of the V2 post-match core, as the Activity Worker sees them.
 *
 * Every one is declared `realtime` in `SCOUT_V2_ACTIVITY_QUEUE_CLASSES`, so
 * they register on the same queue v1's realtime Activities already run on and
 * a worker serving that queue serves both pipelines. Nothing here decides
 * where they run; that assignment lives once, beside the ID builders, and the
 * `satisfies` on it makes an Activity added without a queue a type error.
 *
 * The surface TYPE lives in `match-activity-surface.ts` rather than here, so
 * that naming it does not drag this module — and everything its dynamic
 * imports reach — into another package's type program.
 *
 * The implementations are DYNAMICALLY imported, matching v1's activity
 * factory. Building the activity groups happens during process startup for
 * every role that polls a queue, and a static import chain would pull the
 * betting, progression and league task slices — and the Riot client and Prisma
 * behind them — into a process that may never run a match. Each Activity also
 * heartbeats while it works, so a worker that dies mid-phase is detected by
 * its heartbeat timeout rather than by its start-to-close budget.
 */
export function createScoutV2MatchActivities(): ScoutV2MatchActivities {
  return {
    discoverPostMatchIdsV2: async () =>
      await heartbeatWhile({ phase: "discovering-post-match-v2" }, async () => {
        const { discoverPostMatchIdsV2 } =
          await import("#src/temporal/v2/match-reads.ts");
        // The poll claim is identified by an instant, and the FIRST-scheduled
        // timestamp is the one instant every attempt of this Activity agrees
        // on. An attempt that claimed the poll and then died therefore leaves
        // a claim its own retry re-acquires, rather than one the retry reads
        // as another run's and skips for — which would strand the poll until
        // the staleness bound with no run left to close it.
        return await discoverPostMatchIdsV2({
          claimAt: new Date(Context.current().info.scheduledTimestampMs),
        });
      }),
    readMatchPipelineStateV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "reading-pipeline-state-v2" },
        async () => {
          const { readMatchPipelineStateV2 } =
            await import("#src/temporal/v2/match-reads.ts");
          return await readMatchPipelineStateV2(input);
        },
      ),
    readLegacyMatchCompletionV2: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "reading-legacy-match-completion-v2",
        },
        async () => {
          const { readLegacyMatchCompletionV2 } =
            await import("#src/league/tasks/postmatch/cursor-reconciliation.ts");
          return await readLegacyMatchCompletionV2(input);
        },
      ),
    archiveMatchArtifactsV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "archiving-match-v2" },
        async () => {
          const { archiveMatchArtifactsV2 } =
            await import("#src/temporal/v2/match-archive.ts");
          return await archiveMatchArtifactsV2(input);
        },
      ),
    commitMatchObservationV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "observing-match-v2" },
        async () => {
          const { commitMatchObservationV2 } =
            await import("#src/temporal/v2/match-archive.ts");
          return await commitMatchObservationV2(input);
        },
      ),
    settleMatchMarketsV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "settling-match-v2" },
        async () => {
          const { settleMatchMarketsV2 } =
            await import("#src/temporal/v2/match-effects.ts");
          return await settleMatchMarketsV2(input);
        },
      ),
    applyMatchProgressionV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "progressing-match-v2" },
        async () => {
          const { applyMatchProgressionV2 } =
            await import("#src/temporal/v2/match-effects.ts");
          return await applyMatchProgressionV2(input);
        },
      ),
    finalizeTournamentResultV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "finalizing-tournament-v2" },
        async () => {
          const { finalizeTournamentResultV2 } =
            await import("#src/temporal/v2/match-tournament.ts");
          return await finalizeTournamentResultV2(input);
        },
      ),
    recordMatchReceiptsV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "receipting-match-v2" },
        async () => {
          const { recordMatchReceiptsV2 } =
            await import("#src/temporal/v2/match-commits.ts");
          return await recordMatchReceiptsV2(input);
        },
      ),
    recordClientMatchTerminalV2: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "receipting-client-match-terminal-v2",
        },
        async () => {
          const { recordClientMatchTerminalV2 } =
            await import("#src/temporal/v2/match-commits.ts");
          return await recordClientMatchTerminalV2(input);
        },
      ),
    advanceMatchCursorV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "advancing-cursors-v2" },
        async () => {
          const { advanceMatchCursorV2 } =
            await import("#src/temporal/v2/match-commits.ts");
          return await advanceMatchCursorV2(input);
        },
      ),
    mintPostmatchNotificationIntentsV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "minting-report-intents-v2" },
        async () => {
          const { mintPostmatchNotificationIntentsV2 } =
            await import("#src/temporal/v2/match-effects.ts");
          return await mintPostmatchNotificationIntentsV2(input);
        },
      ),
    planMatchFanOutV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "planning-fan-out-v2" },
        async () => {
          const { planMatchFanOutV2 } =
            await import("#src/temporal/v2/match-reads.ts");
          return await planMatchFanOutV2(input);
        },
      ),
  };
}
