import {
  buildTemporalExecutionStartMetadata,
  ExecutionEnvironmentSchema,
  ExecutionMetadataSchema,
  ReleaseCommitSchema,
  type ExecutionDomain,
  type ExecutionEnvironment,
  type ExecutionMetadata,
  type ExecutionTrigger,
  type TemporalExecutionStartMetadata,
} from "@scout-for-lol/temporal/execution-metadata";
import { TASK_QUEUES, type TaskQueue } from "./task-queues.ts";

export type TemporalBootstrapMetadata = {
  readonly environment: ExecutionEnvironment;
  readonly releaseCommit: string;
};

export function parseTemporalBootstrapMetadata(
  environment: string | undefined,
  releaseCommit: string | undefined,
): TemporalBootstrapMetadata {
  const normalizedEnvironment =
    environment === "production" ? "prod" : environment;
  return {
    environment: ExecutionEnvironmentSchema.parse(normalizedEnvironment),
    releaseCommit: ReleaseCommitSchema.parse(releaseCommit),
  };
}

export function executionDomainForTaskQueue(
  taskQueue: TaskQueue,
): ExecutionDomain {
  switch (taskQueue) {
    case TASK_QUEUES.HOME:
      return "home";
    case TASK_QUEUES.REPORTS:
      return "reports";
    case TASK_QUEUES.INFRA:
      return "infra";
    case TASK_QUEUES.REPO_AUTOMATION:
      return "repo";
    case TASK_QUEUES.SCOUT:
    case TASK_QUEUES.SCOUT_BETA:
    case TASK_QUEUES.SCOUT_PROD:
      return "scout";
    case TASK_QUEUES.AGENT_TASK:
      return "agent";
    case TASK_QUEUES.GLITTER_CORPUS:
    case TASK_QUEUES.GLITTER_CONTEXT:
      return "glitter";
    case TASK_QUEUES.MAINTENANCE:
      return "maintenance";
    case TASK_QUEUES.BACKUP:
      return "platform";
    case TASK_QUEUES.WORKFLOWS:
      return "platform";
  }
}

// Every new central Workflow execution (declared Schedule, ad-hoc client
// start, or dynamic agent-task schedule) now targets the single
// TASK_QUEUES.WORKFLOWS dispatch queue, so executionDomainForTaskQueue alone
// resolves "platform" for everything — home, reports, maintenance, repo, and
// Scout workflows included — and the Domain search attribute loses the power
// to distinguish them. Each workflow's ACTUAL Activity queue (its
// proxyActivities({ taskQueue }) call) still reflects its real domain, so
// this table is derived from that ground truth, not guessed from names.
// Falls back to executionDomainForTaskQueue for any workflowType not listed
// here (new workflows land as "platform" until added, rather than failing).
const WORKFLOW_TYPE_DOMAINS: Readonly<Record<string, ExecutionDomain>> = {
  // packages/temporal/src/workflows/maintenance.ts (TASK_QUEUES.MAINTENANCE)
  runKometaWorkflow: "maintenance",
  runBunCacheGcWorkflow: "maintenance",
  runUvCachePruneWorkflow: "maintenance",
  runTrivyDbRefreshWorkflow: "maintenance",
  runTurboCacheCleanWorkflow: "maintenance",
  // security-schedule-definitions.ts workflows dispatch to
  // TASK_QUEUES.MAINTENANCE despite predating the buildkite-PVC-only framing
  // in that queue's doc comment — the code is the ground truth.
  runMainVulnScanWorkflow: "maintenance",
  runLinkRotScanWorkflow: "maintenance",

  // TASK_QUEUES.INFRA
  runBugsinkHousekeepingWorkflow: "infra",
  runVeleroOrphanAuditWorkflow: "infra",
  runZfsMaintenanceWorkflow: "infra",
  syncGolinks: "infra",
  runTasknotesCanary: "infra",
  runCiIoImpact: "infra",
  runDnsAudit: "infra",
  runHomelabCrdImportsRefresh: "infra",
  runHomelabAuditWorkflow: "infra",

  // TASK_QUEUES.REPO_AUTOMATION
  runLlmCatalogRefresh: "repo",
  fetchSkillCappedManifest: "repo",
  runFreshRssSyncWorkflow: "repo",
  runFliptFlagInventory: "repo",
  generateDependencySummary: "repo",
  runProtobufWatch: "repo",
  runPokeemeraldDataRefresh: "repo",
  cancelBuildkiteBuildsWorkflow: "repo",
  checkPrMergeConflictsWorkflow: "repo",

  // TASK_QUEUES.REPORTS
  pollWorkflowFailuresWorkflow: "reports",
  monitorReportFreshness: "reports",
  deliverReportWorkflow: "reports",

  // TASK_QUEUES.HOME
  runVacuumIfNotHome: "home",
  goodMorningPreheat: "home",
  goodMorningWakeUp: "home",
  goodMorningGetUp: "home",
  goodNight: "home",
  welcomeHome: "home",
  leavingHome: "home",
  reconcileLock: "home",
  motionLight: "home",
  sleepMusic: "home",
  sleepAc: "home",

  // TASK_QUEUES.GLITTER_CORPUS / GLITTER_CONTEXT
  runGlitterCorpusDaily: "glitter",
  runGlitterCorpusBackfill: "glitter",
  runGlitterCorpusChannelBackfill: "glitter",
  runGlitterCorpusChannelOverlap: "glitter",
  runGlitterCorpusInventory: "glitter",
  runGlitterContextRefresh: "glitter",

  // TASK_QUEUES.AGENT_TASK
  agentTaskWorkflow: "agent",

  // TASK_QUEUES.SCOUT / SCOUT_BETA / SCOUT_PROD (packages/temporal and
  // @scout-for-lol/temporal workflows)
  runScoutDataDragonVersionCheck: "scout",
  runScoutDataDragonWeeklyRefresh: "scout",
  runScoutLanePriorsWeeklyRefresh: "scout",
  runScoutSeasonRefreshWorkflow: "scout",
  runScoutShowcaseRefresh: "scout",
  runScoutWeeklyParlayWorkflow: "scout",
  runScoutWeeklyParlayCatchupWorkflow: "scout",
  runScoutBryanBucksAnalyticsWorkflow: "scout",
  runScoutQueueWindowsWatch: "scout",
  runScoutImageGcWorkflow: "scout",
  runScoutCompetitionUpdatesWorkflow: "scout",
  scoutRealtimePollWorkflow: "scout",
  scoutPostMatchDiscoveryWorkflow: "scout",
  scoutIngestionReconciliationWorkflow: "scout",
  scoutBackgroundJobWorkflow: "scout",
  scoutReportLakeWorkflow: "scout",
  scoutReportScheduleReconcilerWorkflow: "scout",

  // No Activities of its own — a genuinely platform-level canary that
  // exercises Worker Deployment routing, not a domain's own work.
  workerDeploymentCanaryWorkflow: "platform",
};

export function executionDomainForWorkflow(
  workflowType: string,
  taskQueue: TaskQueue,
): ExecutionDomain {
  return (
    WORKFLOW_TYPE_DOMAINS[workflowType] ??
    executionDomainForTaskQueue(taskQueue)
  );
}

export function executionEnvironmentForTaskQueue(
  taskQueue: TaskQueue,
  fallback: ExecutionEnvironment,
): ExecutionEnvironment {
  if (taskQueue === TASK_QUEUES.SCOUT_BETA) return "beta";
  if (taskQueue === TASK_QUEUES.SCOUT_PROD) return "prod";
  return fallback;
}

export function buildExecutionMetadata(input: {
  readonly bootstrap: TemporalBootstrapMetadata;
  readonly workflowType: string;
  readonly taskQueue: TaskQueue;
  readonly trigger: ExecutionTrigger;
}): ExecutionMetadata {
  return ExecutionMetadataSchema.parse({
    Environment: executionEnvironmentForTaskQueue(
      input.taskQueue,
      input.bootstrap.environment,
    ),
    Domain: executionDomainForWorkflow(input.workflowType, input.taskQueue),
    Trigger: input.trigger,
    ReleaseCommit: input.bootstrap.releaseCommit,
  });
}

export function buildExecutionStartMetadata(input: {
  readonly bootstrap: TemporalBootstrapMetadata;
  readonly workflowType: string;
  readonly taskQueue: TaskQueue;
  readonly trigger: ExecutionTrigger;
  readonly summary: string;
  readonly description: string;
}): TemporalExecutionStartMetadata {
  return buildTemporalExecutionStartMetadata({
    metadata: buildExecutionMetadata(input),
    summary: input.summary,
    description: input.description,
  });
}
