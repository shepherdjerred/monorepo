import {
  activities,
  agentActivities,
  glitterContextWorkerActivities,
  glitterCorpusWorkerActivities,
  homeActivities,
  infraActivities,
  repoActivities,
  reportActivities,
  scoutActivities,
} from "./activities/index.ts";
import { maintenanceActivities } from "./activities/maintenance.ts";
import { TASK_QUEUES, type TaskQueue } from "./shared/task-queues.ts";
import type { WorkerRole } from "./shared/worker-role.ts";

export type QueueWorkerRole =
  | "agent"
  | "glitter-context"
  | "glitter-corpus"
  | "home"
  | "infra"
  | "legacy"
  | "maintenance"
  | "repo"
  | "reports"
  | "scout";

export type QueueWorkerDefinition = {
  role: QueueWorkerRole;
  taskQueue: TaskQueue;
  activities: object;
  maxConcurrentActivityTaskExecutions?: number;
  maxConcurrentWorkflowTaskExecutions?: number;
};

export const QUEUE_WORKER_DEFINITIONS: readonly QueueWorkerDefinition[] = [
  {
    role: "legacy",
    taskQueue: TASK_QUEUES.DEFAULT,
    activities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "home",
    taskQueue: TASK_QUEUES.HOME,
    activities: homeActivities,
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 4,
  },
  {
    role: "reports",
    taskQueue: TASK_QUEUES.REPORTS,
    activities: reportActivities,
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 4,
  },
  {
    role: "infra",
    taskQueue: TASK_QUEUES.INFRA,
    activities: infraActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "repo",
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    activities: repoActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "scout",
    taskQueue: TASK_QUEUES.SCOUT,
    activities: scoutActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "scout",
    taskQueue: TASK_QUEUES.SCOUT_BETA,
    activities: scoutActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "scout",
    taskQueue: TASK_QUEUES.SCOUT_PROD,
    activities: scoutActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "agent",
    taskQueue: TASK_QUEUES.AGENT_TASK,
    activities: agentActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "glitter-corpus",
    taskQueue: TASK_QUEUES.GLITTER_CORPUS,
    activities: glitterCorpusWorkerActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "glitter-context",
    taskQueue: TASK_QUEUES.GLITTER_CONTEXT,
    activities: glitterContextWorkerActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
  {
    role: "maintenance",
    taskQueue: TASK_QUEUES.MAINTENANCE,
    activities: maintenanceActivities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
  },
];

function roleOwnsDefinition(
  role: WorkerRole,
  definition: QueueWorkerDefinition,
): boolean {
  if (role === "all") {
    return true;
  }
  if (role === "core") {
    return definition.role === "legacy";
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
};

export function getWorkerRoleContract(role: WorkerRole): WorkerRoleContract {
  return {
    workers: QUEUE_WORKER_DEFINITIONS.filter((definition) =>
      roleOwnsDefinition(role, definition),
    ),
    runsGateway: role === "all" || role === "control" || role === "core",
    validatesScheduleEnvironmentLocally: role === "all" || role === "core",
    runsEventBridge: role === "all" || role === "core" || role === "home",
    restoresGlitterCorpusMetrics:
      role === "all" || role === "glitter" || role === "glitter-corpus",
  };
}
