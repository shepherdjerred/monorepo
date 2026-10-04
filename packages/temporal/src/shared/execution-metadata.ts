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

const EXECUTION_DOMAINS_BY_TASK_QUEUE: Readonly<
  Record<TaskQueue, ExecutionDomain>
> = {
  [TASK_QUEUES.WORKFLOWS]: "platform",
  [TASK_QUEUES.HOME]: "home",
  [TASK_QUEUES.REPORTS]: "reports",
  [TASK_QUEUES.INFRA]: "infra",
  [TASK_QUEUES.OPS]: "infra",
  [TASK_QUEUES.MINING_RESET]: "infra",
  [TASK_QUEUES.REPO_AUTOMATION]: "repo",
  [TASK_QUEUES.SCOUT]: "scout",
  [TASK_QUEUES.MAINTENANCE]: "maintenance",
  [TASK_QUEUES.BACKUP]: "platform",
  [TASK_QUEUES.BILLING]: "platform",
  [TASK_QUEUES.AGENT_CHAT_DISPATCH]: "agent",
  [TASK_QUEUES.AGENT_CHAT_RECEIPTS]: "agent",
  [TASK_QUEUES.AGENT_CHAT_INGRESS]: "platform",
  [TASK_QUEUES.AGENT_CHAT_DELIVERY]: "platform",
  [TASK_QUEUES.AGENT_CHAT_IMESSAGE]: "platform",
  [TASK_QUEUES.AGENT_CHAT_PHOTON]: "platform",
  [TASK_QUEUES.SCOUT_BETA]: "scout",
  [TASK_QUEUES.SCOUT_PROD]: "scout",
  [TASK_QUEUES.AGENT_TASK]: "agent",
  [TASK_QUEUES.GLITTER_CORPUS]: "glitter",
  [TASK_QUEUES.GLITTER_CONTEXT]: "glitter",
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
  return EXECUTION_DOMAINS_BY_TASK_QUEUE[taskQueue];
}

/** A role can poll several queues while still representing one telemetry domain. */
export function executionDomainForTaskQueues(
  taskQueues: readonly TaskQueue[],
): ExecutionDomain {
  const first = taskQueues[0];
  if (first === undefined) {
    return "platform";
  }
  const domain = executionDomainForTaskQueue(first);
  return taskQueues.every(
    (taskQueue) => executionDomainForTaskQueue(taskQueue) === domain,
  )
    ? domain
    : "platform";
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
  runVeleroR2OrphanAuditWorkflow: "infra",
  runZfsMaintenanceWorkflow: "infra",
  syncGolinks: "infra",
  runTasknotesCanary: "infra",
  runDnsAudit: "infra",
  runHomelabCrdImportsRefresh: "infra",
  runHomelabAuditWorkflow: "infra",
  runCiIoTelemetry: "infra",
  runOpsSnapshot: "infra",
  runOpsDigest: "infra",
  runMiningWorldResetWorkflow: "infra",

  // TASK_QUEUES.REPO_AUTOMATION
  runLlmCatalogRefresh: "repo",
  fetchSkillCappedManifest: "repo",
  runFreshRssSyncWorkflow: "repo",
  runFliptFlagInventory: "repo",
  runLlmBilledCostReconciliation: "platform",
  generateDependencySummary: "repo",
  runPokeemeraldDataRefresh: "repo",
  cancelCiPipelinesWorkflow: "repo",
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
  agentChatWorkflow: "agent",
  blueBubblesIngressWorkflow: "agent",
  imessageAgentChatWorkflow: "agent",
  photonConversationWorkflow: "agent",
  photonAgentChatWorkflow: "agent",
  agentChatTurnReceiptWorkflow: "agent",
  agentChatCatalogWorkflow: "agent",
  scheduledAgentChatTurnWorkflow: "agent",
  discordAgentChatWorkflow: "agent",
  httpAgentChatWorkflow: "agent",

  // TASK_QUEUES.SCOUT / SCOUT_BETA / SCOUT_PROD (packages/temporal and
  // @scout-for-lol/temporal workflows)
  runScoutDataDragonVersionCheck: "scout",
  runScoutDataDragonWeeklyRefresh: "scout",
  runScoutLanePriorsWeeklyRefresh: "scout",
  runScoutSeasonRefreshWorkflow: "scout",
  runScoutShowcaseRefresh: "scout",
  runScoutBryanBucksAnalyticsWorkflow: "scout",
  runScoutQueueWindowsWatch: "scout",
  runScoutImageGcWorkflow: "scout",
  scoutRealtimePollWorkflow: "scout",
  scoutPostMatchDiscoveryWorkflow: "scout",
  scoutPostMatchDiscoveryV2Workflow: "scout",
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
  return taskQueue === TASK_QUEUES.SCOUT_PROD ? "prod" : fallback;
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
