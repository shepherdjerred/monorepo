import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { Client, Connection } from "@temporalio/client";
import { client } from "#src/discord/client.ts";
import configuration from "#src/configuration.ts";
import type { ScoutTemporalActivityGroups } from "./connected-runtime.ts";
import { PermanentImportError } from "#src/league/initial-history/errors.ts";
import {
  classifyLlmProviderIssue,
  recordProviderIssue,
} from "#src/alerts/provider-metrics.ts";
import {
  isFeatureHardDisabled,
  type FlagName,
} from "#src/configuration/flags.ts";
import { heartbeatWhile, probeQueue, unavailable } from "./activity-runtime.ts";
import { invokeWeeklyParlayAction } from "./weekly-parlay-activity.ts";
type DetachedWorkInput = Parameters<
  ScoutTemporalActivityGroups["background"]["runDetachedBackgroundWork"]
>[0];

async function scheduleReconciliationEnabled(): Promise<boolean> {
  const activityNamespace = Context.current().info.namespace;
  if (activityNamespace === "default") return false;

  const mode = configuration.temporalScheduleReconciliation;
  if (mode === "enabled") return true;
  if (mode === "disabled") return false;

  const legacyNamespace = configuration.temporalLegacyNamespace;
  if (legacyNamespace === undefined) return true;

  const connection =
    configuration.temporalAddress === undefined
      ? await Connection.connect()
      : await Connection.connect({ address: configuration.temporalAddress });
  try {
    const legacyClient = new Client({
      connection,
      namespace: legacyNamespace,
    });
    for await (const schedule of legacyClient.schedule.list()) {
      const description = await legacyClient.schedule
        .getHandle(schedule.scheduleId)
        .describe();
      if (!description.state.paused) return false;
    }
    return true;
  } finally {
    await connection.close();
  }
}

export function providerQuotaApplicationFailure(
  error: unknown,
): ApplicationFailure | null {
  if (classifyLlmProviderIssue(error) !== "quota") {
    return null;
  }
  return ApplicationFailure.nonRetryable(
    error instanceof Error ? error.message : String(error),
    "ProviderQuotaExhausted",
  );
}

async function runDetachedWork(input: DetachedWorkInput): Promise<void> {
  try {
    await heartbeatWhile(
      { kind: input.kind, workId: input.workId, phase: "running" },
      async () => {
        const { executeScoutTemporalWork } =
          await import("#src/temporal/work-store.ts");
        await executeScoutTemporalWork(input, Context.current().info.attempt);
      },
    );
  } catch (error) {
    const quotaFailure = providerQuotaApplicationFailure(error);
    if (quotaFailure !== null) {
      recordProviderIssue({
        app: "scout-for-lol",
        provider: "openrouter",
        kind: "quota",
        source: "betting_parlay",
      });
      throw quotaFailure;
    }
    throw error;
  }
  Context.current().heartbeat({
    kind: input.kind,
    workId: input.workId,
    phase: "complete",
  });
}

export function hardDisabledFeatureForTemporalWork(
  kind: string,
): FlagName | null {
  switch (kind) {
    case "tournament-lobbies":
      return "tournament_lobbies_enabled";
    case "custom-nights-expiry":
      return "custom_nights_enabled";
    case "bucks-reconciliation":
    case "weekly-bucks-leaderboard":
      return "betting_enabled";
    default:
      return null;
  }
}

function temporalWorkHardDisabled(kind: string): boolean {
  const feature = hardDisabledFeatureForTemporalWork(kind);
  return feature !== null && isFeatureHardDisabled(feature);
}

function createRealtimeActivities(): ScoutTemporalActivityGroups["realtime"] {
  return {
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
          const { runIngestionReconciliation } =
            await import("#src/league/tasks/recovery/ingestion-reconciliation.ts");
          await runIngestionReconciliation();
          const { prisma } = await import("#src/database/index.ts");
          const { findQueuedScoutTemporalWork } =
            await import("#src/temporal/work-store.ts");
          const jobs = await prisma.initialMatchHistoryImport.findMany({
            where: {
              phase: { in: ["queued", "matches", "rank", "publish"] },
            },
            select: { puuid: true },
            orderBy: { requestedAt: "asc" },
            take: 100,
          });
          const detachedWorks = await findQueuedScoutTemporalWork();
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
            if (work.kind !== "parlay-generation") {
              throw ApplicationFailure.nonRetryable(
                `Unknown Scout Temporal work kind ${work.kind}`,
                "InvalidTemporalWorkKind",
              );
            }
            const kind: "parlay-generation" = work.kind;
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
    runDetachedBackgroundWork: runDetachedWork,
    runBackgroundJob: async (input) => {
      if (temporalWorkHardDisabled(input.kind)) return;
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
          case "custom-nights-expiry": {
            const { expireCustomNights } =
              await import("#src/customs/expiry.ts");
            await expireCustomNights();
            break;
          }
          case "prediction-ingest":
          case "legacy-backfill":
            unavailable(input.kind);
        }
      });
      Context.current().heartbeat({ kind: input.kind, phase: "complete" });
    },
    invokeScoutWeeklyParlayAction: invokeWeeklyParlayAction,
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
      const activityNamespace = Context.current().info.namespace;
      if (!(await scheduleReconciliationEnabled())) {
        Context.current().heartbeat({
          phase: "skipped",
          reason:
            activityNamespace === "default"
              ? "legacy-namespace-drain"
              : "schedule-reconciliation-disabled",
        });
        return { processed: 0, remaining: 0 };
      }
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
          const { runScoutReportActivity } =
            await import("#src/temporal/report-activity.ts");
          await runScoutReportActivity(input);
        },
      );
      Context.current().heartbeat({
        reportId: input.reportId,
        phase: "complete",
      });
    },
  };
}
function createLakeActivities(): ScoutTemporalActivityGroups["lake"] {
  return {
    probeQueue,
    runDetachedLakeWork: runDetachedWork,
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
