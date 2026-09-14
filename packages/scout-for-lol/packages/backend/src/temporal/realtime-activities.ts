import { Context } from "@temporalio/activity";
import type { ScoutTemporalActivityGroups } from "#src/temporal/connected-runtime.ts";
import { heartbeatWhile, probeQueue } from "#src/temporal/activity-runtime.ts";
import { temporalWorkHardDisabled } from "#src/temporal/work-features.ts";
import { createScoutV2MatchActivities } from "#src/temporal/v2/match-activities.ts";
import { createScoutV2NotificationActivities } from "#src/temporal/v2/notification-activities.ts";
import { createScoutV2PrematchActivities } from "#src/temporal/v2/prematch/prematch-activities.ts";

/**
 * The realtime queue's Activities, for both pipelines.
 *
 * This group lives apart from the other three because it is the one that now
 * carries two pipelines: v1's poll, discovery, maintenance and ingest, plus
 * the nine Activities of the V2 per-match core, the three of its prematch
 * path, and the five that drive one notification intent to Discord.
 * `SCOUT_V2_ACTIVITY_QUEUE_CLASSES` assigns every one of them to this same
 * queue so one worker registration serves an open v1 execution and a V2 one
 * alike.
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
    ...createScoutV2MatchActivities(),
    ...createScoutV2NotificationActivities(),
    ...createScoutV2PrematchActivities(),
    probeQueue,
    pollRealtime: async (input) => {
      if (temporalWorkHardDisabled(input.kind)) return;
      await heartbeatWhile({ kind: input.kind, phase: "running" }, async () => {
        if (input.kind === "prematch") {
          const { checkPreMatch } =
            await import("#src/league/tasks/prematch/index.ts");
          await checkPreMatch();
        } else {
          const { checkTournamentLobbies } =
            await import("#src/league/tournament/poller.ts");
          await checkTournamentLobbies();
        }
      });
      Context.current().heartbeat({ kind: input.kind, phase: "complete" });
    },
    discoverPostMatchIds: async () =>
      await heartbeatWhile(
        { phase: "discovering-postmatch-intents" },
        async () => {
          const { discoverPostMatchIntents } =
            await import("#src/league/tasks/postmatch/match-history-polling.ts");
          return await discoverPostMatchIntents();
        },
      ),
    runPostMatchMaintenance: async (input) => {
      await heartbeatWhile({ phase: "postmatch-maintenance" }, async () => {
        const { runPostMatchMaintenance } =
          await import("#src/league/tasks/postmatch/index.ts");
        await runPostMatchMaintenance({
          settleDareV2Deadlines: input.settleDareV2Deadlines,
          dareEvidenceWatermark:
            input.evidenceWatermark === undefined
              ? undefined
              : new Date(input.evidenceWatermark),
        });
      });
      Context.current().heartbeat({ phase: "complete" });
    },
    ingestMatch: async (input) => {
      await heartbeatWhile(
        { matchId: input.matchId, phase: "ingesting" },
        async () => {
          const { ingestDiscoveredMatch } =
            await import("#src/league/tasks/postmatch/temporal-match-ingestion.ts");
          await ingestDiscoveredMatch(input);
        },
      );
      Context.current().heartbeat({
        matchId: input.matchId,
        phase: "complete",
      });
    },
  };
}
