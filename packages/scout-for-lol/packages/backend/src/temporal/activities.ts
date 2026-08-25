import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { ReportRunIdSchema } from "@scout-for-lol/data";
import { client } from "#src/discord/client.ts";
import type { ScoutTemporalActivityGroups } from "./supervisor.ts";
import { PermanentImportError } from "#src/league/initial-history/errors.ts";
import { MY_SERVER } from "#src/configuration/flags.ts";
import { heartbeatWhile, probeQueue, unavailable } from "./activity-runtime.ts";

function createRealtimeActivities(): ScoutTemporalActivityGroups["realtime"] {
  return {
    probeQueue,
    pollRealtime: async (input) => {
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
          const matches = await discoverPostMatchIntents();
          return { matches };
        },
      ),
    runPostMatchMaintenance: async () => {
      await heartbeatWhile({ phase: "postmatch-maintenance" }, async () => {
        const { runPostMatchMaintenance } =
          await import("#src/league/tasks/postmatch/index.ts");
        await runPostMatchMaintenance();
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

function createInteractiveActivities(): ScoutTemporalActivityGroups["interactive"] {
  return {
    probeQueue,
    runInteractive: async (input) => {
      const { runScoutInteractiveActivity } =
        await import("#src/temporal/interactive-activities.ts");
      return await runScoutInteractiveActivity(input);
    },
    persistInteractiveOutcome: async (input) => {
      const { persistScoutInteractiveOutcome } =
        await import("#src/temporal/interactive-activities.ts");
      return await persistScoutInteractiveOutcome(input);
    },
  };
}

function createBackgroundActivities(): ScoutTemporalActivityGroups["background"] {
  return {
    probeQueue,
    fetchInitialHistoryPage: async (input) => {
      return await heartbeatWhile(
        {
          puuid: input.puuid,
          cursor: input.cursor,
          phase: "processing-page",
        },
        async () => {
          try {
            const { processInitialHistoryWorkflowPage } =
              await import("#src/league/initial-history/workflow-page.ts");
            const result = await processInitialHistoryWorkflowPage(input);
            Context.current().heartbeat({
              puuid: input.puuid,
              cursor: result.nextCursor,
              persistedMatches: result.persistedMatches,
              phase: result.complete ? "complete" : result.nextAction,
            });
            return result;
          } catch (error) {
            if (error instanceof PermanentImportError) {
              throw ApplicationFailure.nonRetryable(error.message, error.name, {
                code: error.code,
              });
            }
            throw error;
          }
        },
      );
    },
    reconcileIngestion: async () => {
      return await heartbeatWhile(
        { phase: "reconciling-ingestion" },
        async () => {
          const { runStartupRecovery } =
            await import("#src/league/tasks/recovery/startup-recovery.ts");
          await runStartupRecovery();
          const { prisma } = await import("#src/database/index.ts");
          const jobs = await prisma.initialMatchHistoryImport.findMany({
            where: {
              phase: { in: ["queued", "matches", "rank", "publish"] },
            },
            select: { puuid: true },
            orderBy: { requestedAt: "asc" },
            take: 100,
          });
          const detachedWorks = await prisma.scoutTemporalWork.findMany({
            where: { state: { in: ["queued", "failed"] } },
            select: { id: true, kind: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          });
          const interactiveRuns = await prisma.scoutInteractiveRun.findMany({
            where: {
              state: "PENDING",
              createdAt: { lte: new Date(Date.now() - 60_000) },
            },
            select: { id: true, kind: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          });
          const parsedDetachedWorks = detachedWorks.map((work) => {
            if (
              work.kind !== "prediction-ingest" &&
              work.kind !== "parlay-generation"
            ) {
              throw ApplicationFailure.nonRetryable(
                `Unknown Scout Temporal work kind ${work.kind}`,
                "InvalidTemporalWorkKind",
              );
            }
            const kind: "prediction-ingest" | "parlay-generation" = work.kind;
            return { kind, workId: work.id };
          });
          const parsedInteractiveRuns = interactiveRuns.map((run) => {
            if (run.kind !== "explore" && run.kind !== "report-ai") {
              throw ApplicationFailure.nonRetryable(
                `Unknown Scout interactive run kind ${run.kind}`,
                "InvalidInteractiveRunKind",
              );
            }
            const kind: "explore" | "report-ai" = run.kind;
            return { kind, databaseRunId: run.id };
          });
          return {
            initialHistoryPuuids: jobs.map((job) => job.puuid),
            detachedWorks: parsedDetachedWorks,
            interactiveRuns: parsedInteractiveRuns,
          };
        },
      );
    },
    runDetachedBackgroundWork: async (input) => {
      await heartbeatWhile(
        { kind: input.kind, workId: input.workId, phase: "running" },
        async () => {
          const { executeScoutTemporalWork } =
            await import("#src/temporal/work-store.ts");
          await executeScoutTemporalWork(input);
        },
      );
      Context.current().heartbeat({
        kind: input.kind,
        workId: input.workId,
        phase: "complete",
      });
    },
    runBackgroundJob: async (input) => {
      await heartbeatWhile({ kind: input.kind, phase: "running" }, async () => {
        switch (input.kind) {
          case "competition-refresh": {
            const { runLifecycleCheck } =
              await import("#src/league/tasks/competition/lifecycle.ts");
            await runLifecycleCheck();
            break;
          }
          case "competition-scheduled-updates": {
            const { runScheduledCompetitionUpdates } =
              await import("#src/league/tasks/competition/scheduled-update-dispatcher.ts");
            await runScheduledCompetitionUpdates();
            break;
          }
          case "competition-validation": {
            const { runDataValidation } =
              await import("#src/league/tasks/cleanup/validate-data.ts");
            await runDataValidation(client);
            break;
          }
          case "bucks-reconciliation": {
            const { reconcileBucksBalances } =
              await import("#src/betting/reconcile.ts");
            await reconcileBucksBalances();
            break;
          }
          case "weekly-bucks-leaderboard": {
            const { runWeeklyBucksLeaderboard } =
              await import("#src/betting/weekly-leaderboard.ts");
            await runWeeklyBucksLeaderboard();
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
      });
      Context.current().heartbeat({ kind: input.kind, phase: "complete" });
    },
    invokeScoutWeeklyParlayAction: async (action) => {
      const result = await heartbeatWhile(
        {
          kind: "weekly-parlay",
          action: action.action,
          periodKey: action.periodKey,
          phase: "running",
        },
        async () => {
          const { runWeeklyParlayControlAction } =
            await import("#src/betting/weekly-parlay-control.ts");
          return await runWeeklyParlayControlAction(action, {
            serverId: MY_SERVER,
            signal: Context.current().cancellationSignal,
          });
        },
      );
      Context.current().heartbeat({
        kind: "weekly-parlay",
        action: action.action,
        periodKey: action.periodKey,
        phase: result.status,
      });
      return result;
    },
    syncScoutBryanBucksAnalytics: async () => {
      const result = await heartbeatWhile(
        { kind: "bryan-bucks-analytics", phase: "running" },
        async () => {
          const { syncBucksAnalytics } =
            await import("#src/analytics/bryan-bucks-sync.ts");
          return await syncBucksAnalytics();
        },
      );
      Context.current().heartbeat({
        kind: "bryan-bucks-analytics",
        phase: "complete",
        ...result,
      });
      return {
        status: "reconciled" as const,
        detail: `Published ${result.ledgerEntries.toString()} ledger entries and ${result.snapshots.toString()} snapshots`,
      };
    },
    drainReportScheduleOutbox: async (input) => {
      const result = await heartbeatWhile(
        { phase: "reconciling-report-schedules" },
        async () => {
          const { syncSystemReports } =
            await import("#src/reports/system-reports.ts");
          const { prisma } = await import("#src/database/index.ts");
          await syncSystemReports({ prisma });
          Context.current().heartbeat({ phase: "draining-outbox" });
          const runtimeModule = await import("#src/temporal/runtime.ts");
          const supervisor = runtimeModule.currentScoutTemporalSupervisor();
          if (supervisor === undefined) {
            throw new Error(
              "Temporal supervisor is unavailable during reconciliation",
            );
          }
          const { drainReportScheduleOutbox } =
            await import("#src/reports/schedule-reconciler.ts");
          return await drainReportScheduleOutbox(
            supervisor.client(),
            input.stage,
          );
        },
      );
      Context.current().heartbeat({ phase: "complete", ...result });
      return result;
    },
    runReport: async (input) => {
      await heartbeatWhile(
        { reportId: input.reportId, phase: "running" },
        async () => {
          const reportId = Number(input.reportId);
          if (!Number.isSafeInteger(reportId) || reportId <= 0) {
            throw ApplicationFailure.nonRetryable(
              `Invalid report ID ${input.reportId}`,
              "InvalidReportId",
            );
          }
          const { prisma } = await import("#src/database/index.ts");
          const report = await prisma.report.findUnique({
            where: { id: reportId },
            select: { revision: true, isEnabled: true },
          });
          if (
            report === null ||
            (input.source === "schedule" && !report.isEnabled) ||
            report.revision !== input.revision
          ) {
            if (input.source === "manual") {
              const staleRunId = ReportRunIdSchema.safeParse(
                input.runId === undefined ? NaN : Number(input.runId),
              );
              if (!staleRunId.success) {
                throw ApplicationFailure.nonRetryable(
                  "Manual report execution requires a valid run ID",
                  "InvalidReportRunId",
                );
              }
              await prisma.reportRun.updateMany({
                where: { id: staleRunId.data, status: "RUNNING" },
                data: {
                  status: "FAILED",
                  completedAt: new Date(),
                  errorMessage:
                    "Report definition changed or was deleted before execution.",
                },
              });
            }
            return;
          }
          Context.current().heartbeat({ reportId, phase: "running" });
          if (input.source === "schedule") {
            const { runDueReports } = await import("#src/reports/scheduler.ts");
            const dispatches = await runDueReports({
              prisma,
              reportId,
              limit: 1,
            });
            const { deliverScheduledReportDispatches } =
              await import("#src/reports/discord-dispatcher.ts");
            if (dispatches.length > 0) {
              await deliverScheduledReportDispatches(dispatches, {
                propagateErrors: true,
              });
            } else {
              const { deliverStoredScheduledReport } =
                await import("#src/reports/discord-dispatcher.ts");
              await deliverStoredScheduledReport(reportId);
            }
          } else {
            const runId = input.runId === undefined ? NaN : Number(input.runId);
            if (!Number.isSafeInteger(runId) || runId <= 0) {
              throw ApplicationFailure.nonRetryable(
                "Manual report execution requires a valid run ID",
                "InvalidReportRunId",
              );
            }
            const fullReport = await prisma.report.findUniqueOrThrow({
              where: { id: reportId },
            });
            const { runReport } = await import("#src/reports/runner.ts");
            const result = await runReport({
              prisma,
              report: fullReport,
              trigger: "MANUAL",
              runId,
            }).catch(async (error: unknown) => {
              const { InvalidSavedQueryError } =
                await import("#src/reports/query-engine.ts");
              if (error instanceof InvalidSavedQueryError) {
                throw ApplicationFailure.nonRetryable(
                  error.message,
                  "InvalidSavedQuery",
                );
              }
              throw error;
            });
            if (input.post) {
              const { deliverReportDispatch } =
                await import("#src/reports/discord-dispatcher.ts");
              await deliverReportDispatch(
                { report: fullReport, result },
                "report_manual",
              );
            }
          }
          Context.current().heartbeat({ reportId, phase: "complete" });
        },
      );
    },
  };
}

function createLakeActivities(): ScoutTemporalActivityGroups["lake"] {
  return {
    probeQueue,
    runDetachedLakeWork: async (input) => {
      await heartbeatWhile(
        { kind: input.kind, workId: input.workId, phase: "running" },
        async () => {
          const { executeScoutTemporalWork } =
            await import("#src/temporal/work-store.ts");
          await executeScoutTemporalWork(input);
        },
      );
      Context.current().heartbeat({
        kind: input.kind,
        workId: input.workId,
        phase: "complete",
      });
    },
    runReportLakeJob: async (input) => {
      await heartbeatWhile({ kind: input.kind, phase: "running" }, async () => {
        const { runReportLakeFold, runReportLakeRebuild } =
          await import("#src/report-lake/compactor.ts");
        const options = {
          onProgress: (progress: {
            phase: string;
            table?: string;
            files?: number;
            rows?: number;
            skipped?: number;
          }) => {
            Context.current().heartbeat({ kind: input.kind, ...progress });
          },
        };
        if (input.kind === "fold") {
          await runReportLakeFold(options);
        } else {
          await runReportLakeRebuild(options);
        }
      });
      Context.current().heartbeat({ kind: input.kind, phase: "complete" });
    },
  };
}

export function createScoutTemporalActivityGroups(): ScoutTemporalActivityGroups {
  return {
    realtime: createRealtimeActivities(),
    interactive: createInteractiveActivities(),
    background: createBackgroundActivities(),
    lake: createLakeActivities(),
  };
}
