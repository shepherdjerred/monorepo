import { Context } from "@temporalio/activity";
import type { ScoutPipelineActivities } from "@scout-for-lol/temporal/activities";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The Activities of the V2 prematch path, as the Activity Worker sees them:
 * the three that detect and capture live games, the market open, and the
 * maintenance pass the discovery poll ends with.
 *
 * All are declared `realtime` in `SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES`, and that
 * is the product decision showing through: a game-start notification is worth
 * nothing after the game, so a spectator read must never queue behind a
 * render or a lake projection.
 *
 * The implementations are DYNAMICALLY imported for the same reason the
 * per-match ones are: building the activity groups happens during startup for
 * every role that polls a queue, and a static import chain would pull the
 * Riot client, the subscription queries and Prisma into a process that may
 * never look at a live game. Each Activity also heartbeats while it works, so
 * a worker that dies mid-capture is detected by its heartbeat timeout rather
 * than by its start-to-close budget.
 */
export type ScoutPrematchActivities = Pick<
  ScoutPipelineActivities,
  | "discoverPrematchGames"
  | "archivePrematchSnapshot"
  | "planPrematchFanOut"
  | "openPrematchMarkets"
  | "runPrematchMaintenance"
>;

export function createScoutPrematchActivities(): ScoutPrematchActivities {
  return {
    discoverPrematchGames: async () =>
      await heartbeatWhile({ phase: "discovering-prematch-v2" }, async () => {
        const { discoverPrematchGames } =
          await import("#src/temporal/prematch/prematch-reads.ts");
        return await discoverPrematchGames();
      }),
    archivePrematchSnapshot: async (input) =>
      await heartbeatWhile(
        {
          gameRef: `${input.gameRef.platform}_${input.gameRef.gameId}`,
          phase: "archiving-prematch-v2",
        },
        async () => {
          const { archivePrematchSnapshot } =
            await import("#src/temporal/prematch/prematch-archive.ts");
          return await archivePrematchSnapshot(input);
        },
      ),
    openPrematchMarkets: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "opening-prematch-markets-v2",
        },
        async () => {
          const { openPrematchMarkets } =
            await import("#src/temporal/prematch/prematch-markets.ts");
          return await openPrematchMarkets(input);
        },
      ),
    planPrematchFanOut: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "planning-prematch-fan-out-v2",
        },
        async () => {
          const { planPrematchFanOut } =
            await import("#src/temporal/prematch/prematch-reads.ts");
          return await planPrematchFanOut(input);
        },
      ),
    runPrematchMaintenance: async () => {
      await heartbeatWhile({ phase: "prematch-maintenance" }, async () => {
        const { runPrematchMaintenance } =
          await import("#src/temporal/prematch/prematch-maintenance.ts");
        await runPrematchMaintenance();
      });
      Context.current().heartbeat({ phase: "complete" });
    },
  };
}
