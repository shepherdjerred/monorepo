import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import type { ScoutTemporalActivityGroups } from "#src/temporal/connected-runtime.ts";
import { heartbeatWhile, probeQueue } from "#src/temporal/activity-runtime.ts";
import { ScoutPostMatchMaintenanceInputSchema } from "@scout-for-lol/temporal/contracts";
import { createScoutMatchActivities } from "#src/temporal/match/match-activities.ts";
import { createScoutNotificationActivities } from "#src/temporal/notification-lane/notification-activities.ts";
import { createScoutPrematchActivities } from "#src/temporal/prematch/prematch-activities.ts";

/**
 * The realtime queue's Activities: the per-match core, its prematch path, the
 * five that drive one notification intent to Discord, and post-match
 * maintenance. `SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES` assigns every one of them to
 * this queue.
 *
 * The notification lane's sixth Activity, the render, is absent on purpose: it
 * belongs to `background`, so a Satori pass can never queue ahead of a live
 * match.
 *
 * Implementations stay dynamically imported: building the activity groups
 * happens during startup for every role that polls a queue, and a static
 * import chain would pull the league task slices, the Riot client and Prisma
 * into a process that may never run a match.
 */

export function createRealtimeActivities(): ScoutTemporalActivityGroups["realtime"] {
  return {
    ...createScoutMatchActivities(),
    ...createScoutNotificationActivities(),
    ...createScoutPrematchActivities(),
    probeQueue,
    runPostMatchMaintenance: async (input) => {
      const pollOwner =
        ScoutPostMatchMaintenanceInputSchema.shape.pollOwner.safeParse(
          input.pollOwner,
        );
      if (!pollOwner.success) {
        // Every discovery claims its poll before maintenance runs, so a
        // maintenance input without one is a broken contract, not a retry.
        throw ApplicationFailure.nonRetryable(
          "Post-match maintenance requires the poll claim its discovery opened",
          "MissingPostMatchPollOwner",
        );
      }
      await heartbeatWhile({ phase: "postmatch-maintenance" }, async () => {
        const { runPostMatchMaintenance } =
          await import("#src/league/tasks/postmatch/index.ts");
        const { PostMatchPollOwnershipError } =
          await import("#src/league/tasks/recovery/app-state.ts");
        try {
          await runPostMatchMaintenance({
            settleDareV2Deadlines: input.settleDareV2Deadlines,
            dareEvidenceWatermark:
              input.evidenceWatermark === undefined
                ? undefined
                : new Date(input.evidenceWatermark),
            pollOwner: { startedAt: new Date(pollOwner.data) },
          });
        } catch (error) {
          // A poll this run no longer owns is not a transient fault: the
          // identity is gone and every retry meets the same standing row. Fail
          // the run instead, where an operator sees which poll was taken over.
          if (error instanceof PostMatchPollOwnershipError) {
            throw ApplicationFailure.nonRetryable(error.message, error.name);
          }
          throw error;
        }
      });
      Context.current().heartbeat({ phase: "complete" });
    },
  };
}
