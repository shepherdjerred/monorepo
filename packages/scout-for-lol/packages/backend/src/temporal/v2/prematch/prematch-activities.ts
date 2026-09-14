import type { ScoutTemporalV2Activities } from "@scout-for-lol/temporal/activities";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The three Activities of the V2 prematch path, as the Activity Worker sees
 * them.
 *
 * All three are declared `realtime` in `SCOUT_V2_ACTIVITY_QUEUE_CLASSES`, and
 * that is the product decision showing through: a game-start notification is
 * worth nothing after the game, so a spectator read must never queue behind a
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
export type ScoutV2PrematchActivities = Pick<
  ScoutTemporalV2Activities,
  | "discoverPrematchGamesV2"
  | "archivePrematchSnapshotV2"
  | "planPrematchFanOutV2"
>;

export function createScoutV2PrematchActivities(): ScoutV2PrematchActivities {
  return {
    discoverPrematchGamesV2: async () =>
      await heartbeatWhile({ phase: "discovering-prematch-v2" }, async () => {
        const { discoverPrematchGamesV2 } =
          await import("#src/temporal/v2/prematch/prematch-reads.ts");
        return await discoverPrematchGamesV2();
      }),
    archivePrematchSnapshotV2: async (input) =>
      await heartbeatWhile(
        {
          gameRef: `${input.gameRef.platform}_${input.gameRef.gameId}`,
          phase: "archiving-prematch-v2",
        },
        async () => {
          const { archivePrematchSnapshotV2 } =
            await import("#src/temporal/v2/prematch/prematch-archive.ts");
          return await archivePrematchSnapshotV2(input);
        },
      ),
    planPrematchFanOutV2: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "planning-prematch-fan-out-v2",
        },
        async () => {
          const { planPrematchFanOutV2 } =
            await import("#src/temporal/v2/prematch/prematch-reads.ts");
          return await planPrematchFanOutV2(input);
        },
      ),
  };
}
