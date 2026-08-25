import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { client } from "#src/discord/client.ts";
import type { ScoutTemporalActivityGroups } from "./supervisor.ts";

function unavailable(activity: string): never {
  throw ApplicationFailure.nonRetryable(
    `Scout Temporal activity ${activity} has no enabled workload owner`,
    "DisabledWorkload",
  );
}

export function createScoutTemporalActivityGroups(): ScoutTemporalActivityGroups {
  return {
    realtime: {
      pollRealtime: async (input) => {
        Context.current().heartbeat({ kind: input.kind, phase: "starting" });
        if (input.kind === "prematch") {
          const { checkPreMatch } =
            await import("#src/league/tasks/prematch/index.ts");
          await checkPreMatch();
        } else {
          const { checkTournamentLobbies } =
            await import("#src/league/tournament/poller.ts");
          await checkTournamentLobbies();
        }
        Context.current().heartbeat({ kind: input.kind, phase: "complete" });
      },
      discoverPostMatchIds: async () => {
        const { checkPostMatch } =
          await import("#src/league/tasks/postmatch/index.ts");
        await checkPostMatch();
        return { matchIds: [] };
      },
      ingestMatch: () => unavailable("ingestMatch"),
    },
    interactive: {
      runInteractive: () => unavailable("runInteractive"),
      persistInteractiveOutcome: () => unavailable("persistInteractiveOutcome"),
    },
    background: {
      fetchInitialHistoryPage: () => unavailable("fetchInitialHistoryPage"),
      reconcileIngestion: async () => {
        const { runStartupRecovery } =
          await import("#src/league/tasks/recovery/startup-recovery.ts");
        await runStartupRecovery();
      },
      runBackgroundJob: async (input) => {
        Context.current().heartbeat({ kind: input.kind, phase: "starting" });
        switch (input.kind) {
          case "competition-refresh": {
            const { runLifecycleCheck } =
              await import("#src/league/tasks/competition/lifecycle.ts");
            await runLifecycleCheck();
            break;
          }
          case "competition-validation": {
            const { runDataValidation } =
              await import("#src/league/tasks/cleanup/validate-data.ts");
            await runDataValidation(client);
            break;
          }
          case "player-pruning": {
            const { runPlayerPruning } =
              await import("#src/league/tasks/cleanup/prune-players.ts");
            await runPlayerPruning();
            break;
          }
          case "removed-guild-cleanup": {
            const { reconcileRemovedGuilds } =
              await import("#src/league/tasks/cleanup/reconcile-removed-guilds.ts");
            await reconcileRemovedGuilds(client);
            break;
          }
          case "match-time-rebuild": {
            const { refreshMatchTimes } =
              await import("#src/league/tasks/maintenance/refresh-match-times.ts");
            await refreshMatchTimes();
            break;
          }
          case "outreach": {
            const { runOutreach } =
              await import("#src/league/tasks/outreach/index.ts");
            await runOutreach(client);
            break;
          }
          case "conversion-check": {
            const { updateOutreachConversionMetrics } =
              await import("#src/league/tasks/outreach/conversions.ts");
            await updateOutreachConversionMetrics();
            break;
          }
          case "summoner-index-backfill": {
            const { backfillFromExisting } =
              await import("#src/lib/riot/summoner-index.ts");
            await backfillFromExisting();
            break;
          }
          case "prediction-ingest":
          case "legacy-backfill":
            unavailable(input.kind);
        }
        Context.current().heartbeat({ kind: input.kind, phase: "complete" });
      },
      drainReportScheduleOutbox: () => unavailable("drainReportScheduleOutbox"),
      runReport: () => unavailable("runReport"),
    },
    lake: {
      runReportLakeJob: async (input) => {
        Context.current().heartbeat({ kind: input.kind, phase: "starting" });
        const { runReportLakeFold, runReportLakeRebuild } =
          await import("#src/report-lake/compactor.ts");
        if (input.kind === "fold") {
          await runReportLakeFold();
        } else {
          await runReportLakeRebuild();
        }
        Context.current().heartbeat({ kind: input.kind, phase: "complete" });
      },
    },
  };
}
