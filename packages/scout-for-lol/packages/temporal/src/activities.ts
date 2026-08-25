import type {
  InitialHistoryPageResult,
  InteractiveOutcome,
  PostMatchDiscoveryResult,
  ReportScheduleDrainResult,
  ScoutBackgroundJobInput,
  ScoutIngestionReconciliationInput,
  ScoutInitialHistoryInput,
  ScoutInteractiveRunInput,
  ScoutMatchIngestionInput,
  ScoutPostMatchDiscoveryInput,
  ScoutRealtimePollInput,
  ScoutReportLakeInput,
  ScoutReportRunInput,
  ScoutReportScheduleReconcilerInput,
} from "./contracts.ts";

export type ScoutTemporalActivities = {
  pollRealtime: (input: ScoutRealtimePollInput) => Promise<void>;
  discoverPostMatchIds: (
    input: ScoutPostMatchDiscoveryInput,
  ) => Promise<PostMatchDiscoveryResult>;
  ingestMatch: (input: ScoutMatchIngestionInput) => Promise<void>;
  fetchInitialHistoryPage: (
    input: ScoutInitialHistoryInput,
  ) => Promise<InitialHistoryPageResult>;
  reconcileIngestion: (
    input: ScoutIngestionReconciliationInput,
  ) => Promise<void>;
  runBackgroundJob: (input: ScoutBackgroundJobInput) => Promise<void>;
  runReportLakeJob: (input: ScoutReportLakeInput) => Promise<void>;
  drainReportScheduleOutbox: (
    input: ScoutReportScheduleReconcilerInput,
  ) => Promise<ReportScheduleDrainResult>;
  runReport: (input: ScoutReportRunInput) => Promise<void>;
  runInteractive: (
    input: ScoutInteractiveRunInput,
  ) => Promise<InteractiveOutcome>;
  persistInteractiveOutcome: (
    input: ScoutInteractiveRunInput & { outcome: InteractiveOutcome },
  ) => Promise<InteractiveOutcome>;
};
