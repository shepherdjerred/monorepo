import { Context } from "@temporalio/activity";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";
import type { ScoutMatchActivities } from "#src/temporal/match/match-activity-surface.ts";

/**
 * The Activities of the V2 post-match core, as the Activity Worker sees them.
 *
 * Every one is declared `realtime` in `SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES`.
 * Nothing here decides where they run; that assignment lives once, beside the
 * ID builders, and the `satisfies` on it makes an Activity added without a
 * queue a type error.
 *
 * The surface TYPE lives in `match-activity-surface.ts` rather than here, so
 * that naming it does not drag this module — and everything its dynamic
 * imports reach — into another package's type program.
 *
 * The implementations are DYNAMICALLY imported. Building the activity groups happens during process startup for
 * every role that polls a queue, and a static import chain would pull the
 * betting, progression and league task slices — and the Riot client and Prisma
 * behind them — into a process that may never run a match. Each Activity also
 * heartbeats while it works, so a worker that dies mid-phase is detected by
 * its heartbeat timeout rather than by its start-to-close budget.
 */
export function createScoutMatchActivities(): ScoutMatchActivities {
  return {
    discoverPostMatchIds: async () =>
      await heartbeatWhile({ phase: "discovering-post-match-v2" }, async () => {
        const { discoverPostMatchIds } =
          await import("#src/temporal/match/match-reads.ts");
        // The poll claim is identified by an instant, and the FIRST-scheduled
        // timestamp is the one instant every attempt of this Activity agrees
        // on. An attempt that claimed the poll and then died therefore leaves
        // a claim its own retry re-acquires, rather than one the retry reads
        // as another run's and skips for — which would strand the poll until
        // the staleness bound with no run left to close it.
        return await discoverPostMatchIds({
          claimAt: new Date(Context.current().info.scheduledTimestampMs),
        });
      }),
    readMatchPipelineState: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "reading-pipeline-state-v2" },
        async () => {
          const { readMatchPipelineState } =
            await import("#src/temporal/match/match-reads.ts");
          return await readMatchPipelineState(input);
        },
      ),
    readLegacyMatchCompletionV2: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "reading-legacy-match-completion-v2",
        },
        async () => {
          const { readLegacyMatchCompletion } =
            await import("#src/temporal/match/legacy-completion.ts");
          return await readLegacyMatchCompletion(input);
        },
      ),
    archiveMatchArtifacts: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "archiving-match-v2" },
        async () => {
          const { archiveMatchArtifacts } =
            await import("#src/temporal/match/match-archive.ts");
          return await archiveMatchArtifacts(input);
        },
      ),
    commitMatchObservation: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "observing-match-v2" },
        async () => {
          const { commitMatchObservation } =
            await import("#src/temporal/match/match-archive.ts");
          return await commitMatchObservation(input);
        },
      ),
    settleMatchMarkets: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "settling-match-v2" },
        async () => {
          const { settleMatchMarkets } =
            await import("#src/temporal/match/match-effects.ts");
          return await settleMatchMarkets(input);
        },
      ),
    applyMatchProgression: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "progressing-match-v2" },
        async () => {
          const { applyMatchProgression } =
            await import("#src/temporal/match/match-effects.ts");
          return await applyMatchProgression(input);
        },
      ),
    finalizeTournamentResult: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "finalizing-tournament-v2" },
        async () => {
          const { finalizeTournamentResult } =
            await import("#src/temporal/match/match-tournament.ts");
          return await finalizeTournamentResult(input);
        },
      ),
    recordMatchReceipts: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "receipting-match-v2" },
        async () => {
          const { recordMatchReceipts } =
            await import("#src/temporal/match/match-commits.ts");
          return await recordMatchReceipts(input);
        },
      ),
    recordClientMatchTerminal: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "receipting-client-match-terminal-v2",
        },
        async () => {
          const { recordClientMatchTerminal } =
            await import("#src/temporal/match/match-commits.ts");
          return await recordClientMatchTerminal(input);
        },
      ),
    advanceMatchCursor: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "advancing-cursors-v2" },
        async () => {
          const { advanceMatchCursor } =
            await import("#src/temporal/match/match-commits.ts");
          return await advanceMatchCursor(input);
        },
      ),
    mintPostmatchNotificationIntents: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "minting-report-intents-v2" },
        async () => {
          const { mintPostmatchNotificationIntents } =
            await import("#src/temporal/match/match-effects.ts");
          return await mintPostmatchNotificationIntents(input);
        },
      ),
    planMatchFanOut: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "planning-fan-out-v2" },
        async () => {
          const { planMatchFanOut } =
            await import("#src/temporal/match/match-reads.ts");
          return await planMatchFanOut(input);
        },
      ),
  };
}
