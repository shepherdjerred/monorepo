import {
  agentActivities,
  glitterContextWorkerActivities,
  glitterCorpusWorkerActivities,
  homeActivities,
  infraActivities,
  repoActivities,
  reportActivities,
  scoutActivities,
  maintenanceWorkerActivities,
  backupWorkerActivities,
} from "./activities/index.ts";
import { TASK_QUEUES, type TaskQueue } from "./shared/task-queues.ts";
import type { WorkerRole } from "./shared/worker-role.ts";

export type QueueWorkerRole =
  | "agent"
  | "backup"
  | "glitter-context"
  | "glitter-corpus"
  | "home"
  | "infra"
  | "maintenance"
  | "repo"
  | "reports"
  | "scout"
  | "workflows";

type ActivityWorkerDefinition = {
  kind: "activity";
  role: Exclude<QueueWorkerRole, "workflows">;
  taskQueue: TaskQueue;
  activities: object;
  maxConcurrentActivityTaskExecutions?: number;
};

type WorkflowWorkerDefinition = {
  kind: "workflow";
  role: "workflows";
  taskQueue: TaskQueue;
  maxConcurrentWorkflowTaskExecutions?: number;
};

export type QueueWorkerDefinition =
  ActivityWorkerDefinition | WorkflowWorkerDefinition;

const ACTIVITY_WORKER_DEFINITIONS: readonly ActivityWorkerDefinition[] = [
  {
    kind: "activity",
    role: "backup",
    taskQueue: TASK_QUEUES.BACKUP,
    activities: backupWorkerActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
  {
    kind: "activity",
    role: "home",
    taskQueue: TASK_QUEUES.HOME,
    activities: homeActivities,
    maxConcurrentActivityTaskExecutions: 4,
  },
  {
    kind: "activity",
    role: "reports",
    taskQueue: TASK_QUEUES.REPORTS,
    activities: reportActivities,
    maxConcurrentActivityTaskExecutions: 4,
  },
  {
    kind: "activity",
    role: "infra",
    taskQueue: TASK_QUEUES.INFRA,
    activities: infraActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
  {
    kind: "activity",
    role: "repo",
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    activities: repoActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
  {
    kind: "activity",
    role: "scout",
    taskQueue: TASK_QUEUES.SCOUT,
    activities: scoutActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
  {
    kind: "activity",
    role: "agent",
    taskQueue: TASK_QUEUES.AGENT_TASK,
    activities: agentActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
  {
    kind: "activity",
    role: "glitter-corpus",
    taskQueue: TASK_QUEUES.GLITTER_CORPUS,
    activities: glitterCorpusWorkerActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
  {
    kind: "activity",
    role: "glitter-context",
    taskQueue: TASK_QUEUES.GLITTER_CONTEXT,
    activities: glitterContextWorkerActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
  {
    kind: "activity",
    role: "maintenance",
    taskQueue: TASK_QUEUES.MAINTENANCE,
    activities: maintenanceWorkerActivities,
    maxConcurrentActivityTaskExecutions: 1,
  },
];

const WORKFLOW_WORKER_DEFINITIONS: readonly WorkflowWorkerDefinition[] = [
  {
    kind: "workflow",
    role: "workflows",
    taskQueue: TASK_QUEUES.WORKFLOWS,
    maxConcurrentWorkflowTaskExecutions: 8,
  },
];

export const WORKFLOW_TASK_QUEUES = [TASK_QUEUES.WORKFLOWS] as const;

export const QUEUE_WORKER_DEFINITIONS: readonly QueueWorkerDefinition[] = [
  ...ACTIVITY_WORKER_DEFINITIONS,
  ...WORKFLOW_WORKER_DEFINITIONS,
];

/*
 * Each process role selects either effectful Activity Workers or the shared
 * deterministic Workflow Workers. The local `all` role still composes both.
 */
function roleOwnsDefinition(
  role: WorkerRole,
  definition: QueueWorkerDefinition,
): boolean {
  if (role === "all") {
    return true;
  }
  if (role === "workflows") {
    return definition.kind === "workflow";
  }
  if (definition.kind === "workflow") {
    return false;
  }
  if (role === "glitter") {
    return (
      definition.role === "glitter-corpus" ||
      definition.role === "glitter-context"
    );
  }
  return role === definition.role;
}

export type WorkerRoleContract = {
  workers: readonly QueueWorkerDefinition[];
  runsGateway: boolean;
  validatesScheduleEnvironmentLocally: boolean;
  runsEventBridge: boolean;
  restoresGlitterCorpusMetrics: boolean;
  restoresSeaweedFsBackupMetrics: boolean;
};

export function getWorkerRoleContract(role: WorkerRole): WorkerRoleContract {
  return {
    workers: QUEUE_WORKER_DEFINITIONS.filter((definition) =>
      roleOwnsDefinition(role, definition),
    ),
    runsGateway: role === "all" || role === "control",
    validatesScheduleEnvironmentLocally: role === "all",
    runsEventBridge: role === "all" || role === "home",
    restoresGlitterCorpusMetrics:
      role === "all" || role === "glitter" || role === "glitter-corpus",
    restoresSeaweedFsBackupMetrics: role === "all" || role === "backup",
  };
}
