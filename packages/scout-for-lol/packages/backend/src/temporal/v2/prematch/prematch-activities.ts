import { Context } from "@temporalio/activity";
import type { ScoutTemporalV2Activities } from "@scout-for-lol/temporal/activities";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The Activities of the V2 prematch path, as the Activity Worker sees them:
 * the three that detect and capture live games, and the three the prematch
 * ownership router takes, renews and releases its pass claim through.
 *
 * All six are declared `realtime` in `SCOUT_V2_ACTIVITY_QUEUE_CLASSES`, and
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
  | "resolvePrematchPassOwnerV2"
  | "renewPrematchPassClaimV2"
  | "releasePrematchPassClaimV2"
>;

export function createScoutV2PrematchActivities(): ScoutV2PrematchActivities {
  return {
    resolvePrematchPassOwnerV2: async () =>
      await heartbeatWhile(
        { phase: "resolving-prematch-owner-v2" },
        async () => {
          const { resolvePrematchPassOwnerV2 } =
            await import("#src/temporal/v2/ownership/prematch-ownership.ts");
          const info = Context.current().info;
          // The run ID is the one identity every attempt of this Activity, and
          // the renewal and release after it, agree on; the first-scheduled
          // timestamp is the one claim instant they agree on.
          const run = info.workflowExecution;
          if (run === undefined) {
            throw new Error(
              "resolvePrematchPassOwnerV2 ran outside a Workflow, so no run can hold the prematch pass claim",
            );
          }
          return await resolvePrematchPassOwnerV2({
            holder: run.runId,
            claimedAt: new Date(info.scheduledTimestampMs),
            now: new Date(),
          });
        },
      ),
    renewPrematchPassClaimV2: async (input) =>
      await heartbeatWhile(
        { phase: "renewing-prematch-claim-v2" },
        async () => {
          const { renewPrematchPassClaimV2 } =
            await import("#src/temporal/v2/ownership/prematch-ownership.ts");
          return await renewPrematchPassClaimV2({
            holder: input.holder,
            renewedAt: new Date(),
          });
        },
      ),
    releasePrematchPassClaimV2: async (input) =>
      await heartbeatWhile(
        { phase: "releasing-prematch-claim-v2" },
        async () => {
          const { releasePrematchPassClaimV2 } =
            await import("#src/temporal/v2/ownership/prematch-ownership.ts");
          return await releasePrematchPassClaimV2({ holder: input.holder });
        },
      ),
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
