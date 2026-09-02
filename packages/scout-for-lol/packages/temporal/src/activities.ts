import type {
  InitialHistoryPageResult,
  IngestionReconciliationResult,
  InteractiveOutcome,
  PostMatchDiscoveryResult,
  ReportScheduleDrainResult,
  ScoutBackgroundJobInput,
  ScoutDetachedWorkInput,
  ScoutIngestionReconciliationInput,
  ScoutInitialHistoryInput,
  ScoutInteractiveRunInput,
  ScoutMatchIngestionInput,
  ScoutPostMatchDiscoveryInput,
  ScoutPostMatchMaintenanceInput,
  ScoutQueueCanaryProbeInput,
  ScoutQueueCanaryProbeResult,
  ScoutRealtimePollInput,
  ScoutReportLakeInput,
  ScoutReportActivityInput,
  ScoutReportScheduleReconcilerInput,
} from "./contracts.ts";

export type ScoutTemporalActivities = {
  probeQueue: (
    input: ScoutQueueCanaryProbeInput,
  ) => Promise<ScoutQueueCanaryProbeResult>;
  pollRealtime: (input: ScoutRealtimePollInput) => Promise<void>;
  discoverPostMatchIds: (
    input: ScoutPostMatchDiscoveryInput,
  ) => Promise<PostMatchDiscoveryResult>;
  runPostMatchMaintenance: (
    input: ScoutPostMatchMaintenanceInput,
  ) => Promise<void>;
  ingestMatch: (input: ScoutMatchIngestionInput) => Promise<void>;
  fetchInitialHistoryPage: (
    input: ScoutInitialHistoryInput,
  ) => Promise<InitialHistoryPageResult>;
  reconcileIngestion: (
    input: ScoutIngestionReconciliationInput,
  ) => Promise<IngestionReconciliationResult>;
  runBackgroundJob: (input: ScoutBackgroundJobInput) => Promise<void>;
  runDetachedBackgroundWork: (input: ScoutDetachedWorkInput) => Promise<void>;
  runDetachedLakeWork: (input: ScoutDetachedWorkInput) => Promise<void>;
  runReportLakeJob: (input: ScoutReportLakeInput) => Promise<void>;
  drainReportScheduleOutbox: (
    input: ScoutReportScheduleReconcilerInput,
  ) => Promise<ReportScheduleDrainResult>;
  runReport: (input: ScoutReportActivityInput) => Promise<void>;
  runInteractive: (
    input: ScoutInteractiveRunInput,
  ) => Promise<InteractiveOutcome>;
  persistInteractiveOutcome: (
    input: ScoutInteractiveRunInput & { outcome: InteractiveOutcome },
  ) => Promise<InteractiveOutcome>;
};
