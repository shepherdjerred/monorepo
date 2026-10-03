import { Context } from "@temporalio/activity";
import type { ScoutTemporalV2Activities } from "@scout-for-lol/temporal/activities";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The Activities of the V2 prematch path, as the Activity Worker sees them:
 * the three that detect and capture live games, the market open, the
 * maintenance pass the discovery poll ends with, and the three the retired
 * prematch ownership router still calls.
 *
 * All are declared `realtime` in `SCOUT_V2_ACTIVITY_QUEUE_CLASSES`, and that
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
export type ScoutV2PrematchActivities = Pick<
  ScoutTemporalV2Activities,
  | "discoverPrematchGamesV2"
  | "archivePrematchSnapshotV2"
  | "planPrematchFanOutV2"
  | "openPrematchMarketsV2"
  | "runPrematchMaintenance"
  | "resolvePrematchPassOwnerV2"
  | "renewPrematchPassClaimV2"
  | "releasePrematchPassClaimV2"
>;

export function createScoutV2PrematchActivities(): ScoutV2PrematchActivities {
  return {
    ...retiredPrematchOwnershipActivities(),
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
    openPrematchMarketsV2: async (input) =>
      await heartbeatWhile(
        {
          riotMatchId: input.riotMatchId,
          phase: "opening-prematch-markets-v2",
        },
        async () => {
          const { openPrematchMarketsV2 } =
            await import("#src/temporal/v2/prematch/prematch-markets.ts");
          return await openPrematchMarketsV2(input);
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
    runPrematchMaintenance: async () => {
      await heartbeatWhile({ phase: "prematch-maintenance" }, async () => {
        const { runPrematchMaintenance } =
          await import("#src/temporal/v2/prematch/prematch-maintenance.ts");
        await runPrematchMaintenance();
      });
      Context.current().heartbeat({ phase: "complete" });
    },
  };
}

/**
 * The prematch ownership router's three Activities, answering as constants.
 *
 * The router (`scoutRealtimePollWorkflow`'s prematch arm) is retired: the
 * `prematch-poll` Schedule starts V2 discovery directly. These stay
 * registered because a v1 poll can still reach them — one open when the
 * change deployed, one the not-yet-updated Schedule started, or a recorded
 * read retrying — and an unregistered Activity would fail that poll on every
 * retry instead of letting it finish.
 *
 * Every answer is `run-v2`: the router then runs V2 discovery as a child and
 * v1's maintenance, and v1 detects nothing. The durable pass claim is gone, so
 * no claim backs the answer, and the renewal and release report `not-held`.
 */
function retiredPrematchOwnershipActivities(): Pick<
  ScoutV2PrematchActivities,
  | "resolvePrematchPassOwnerV2"
  | "renewPrematchPassClaimV2"
  | "releasePrematchPassClaimV2"
> {
  return {
    resolvePrematchPassOwnerV2: () => {
      const info = Context.current().info;
      const run = info.workflowExecution;
      if (run === undefined) {
        throw new Error(
          "resolvePrematchPassOwnerV2 ran outside a Workflow, so there is no run to name as the pass holder",
        );
      }
      return Promise.resolve({
        decision: "run-v2",
        holder: run.runId,
        claimedAt: IsoInstantSchema.parse(
          new Date(info.scheduledTimestampMs).toISOString(),
        ),
      });
    },
    renewPrematchPassClaimV2: () => Promise.resolve({ outcome: "not-held" }),
    releasePrematchPassClaimV2: () => Promise.resolve({ outcome: "not-held" }),
  };
}
