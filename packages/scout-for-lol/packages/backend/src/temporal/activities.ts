import type { ScoutTemporalActivityGroups } from "./supervisor.ts";

function unavailable(activity: string): never {
  throw new Error(
    `Scout Temporal activity ${activity} is not active in the foundation rollout`,
  );
}

export function createScoutTemporalActivityGroups(): ScoutTemporalActivityGroups {
  return {
    realtime: {
      pollRealtime: () => unavailable("pollRealtime"),
      discoverPostMatchIds: () => unavailable("discoverPostMatchIds"),
      ingestMatch: () => unavailable("ingestMatch"),
    },
    interactive: {
      runInteractive: () => unavailable("runInteractive"),
      persistInteractiveOutcome: () => unavailable("persistInteractiveOutcome"),
    },
    background: {
      fetchInitialHistoryPage: () => unavailable("fetchInitialHistoryPage"),
      reconcileIngestion: () => unavailable("reconcileIngestion"),
      runBackgroundJob: () => unavailable("runBackgroundJob"),
      drainReportScheduleOutbox: () => unavailable("drainReportScheduleOutbox"),
      runReport: () => unavailable("runReport"),
    },
    lake: {
      runReportLakeJob: () => unavailable("runReportLakeJob"),
    },
  };
}
