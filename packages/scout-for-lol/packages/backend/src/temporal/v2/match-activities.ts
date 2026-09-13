import type { ScoutTemporalV2Activities } from "@scout-for-lol/temporal/activities";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The nine Activities of the V2 post-match core, as the Activity Worker sees
 * them.
 *
 * Every one is declared `realtime` in `SCOUT_V2_ACTIVITY_QUEUE_CLASSES`, so
 * they register on the same queue v1's realtime Activities already run on and
 * a worker serving that queue serves both pipelines. Nothing here decides
 * where they run; that assignment lives once, beside the ID builders, and the
 * `satisfies` on it makes an Activity added without a queue a type error.
 *
 * The implementations are DYNAMICALLY imported, matching v1's activity
 * factory. Building the activity groups happens during process startup for
 * every role that polls a queue, and a static import chain would pull the
 * betting, progression and league task slices — and the Riot client and Prisma
 * behind them — into a process that may never run a match. Each Activity also
 * heartbeats while it works, so a worker that dies mid-phase is detected by
 * its heartbeat timeout rather than by its start-to-close budget.
 */
export type ScoutV2MatchActivities = Pick<
  ScoutTemporalV2Activities,
  | "discoverPostMatchIdsV2"
  | "readMatchPipelineStateV2"
  | "archiveMatchArtifactsV2"
  | "commitMatchObservationV2"
  | "settleMatchMarketsV2"
  | "applyMatchProgressionV2"
  | "recordMatchReceiptsV2"
  | "advanceMatchCursorV2"
  | "planMatchFanOutV2"
>;

export function createScoutV2MatchActivities(): ScoutV2MatchActivities {
  return {
    discoverPostMatchIdsV2: async () =>
      await heartbeatWhile({ phase: "discovering-post-match-v2" }, async () => {
        const { discoverPostMatchIdsV2 } =
          await import("#src/temporal/v2/match-reads.ts");
        return await discoverPostMatchIdsV2();
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
    recordMatchReceiptsV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "receipting-match-v2" },
        async () => {
          const { recordMatchReceiptsV2 } =
            await import("#src/temporal/v2/match-commits.ts");
          return await recordMatchReceiptsV2(input);
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
