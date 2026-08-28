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
    case TASK_QUEUES.DEFAULT:
      return "platform";
  }
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
  readonly taskQueue: TaskQueue;
  readonly trigger: ExecutionTrigger;
}): ExecutionMetadata {
  return ExecutionMetadataSchema.parse({
    Environment: executionEnvironmentForTaskQueue(
      input.taskQueue,
      input.bootstrap.environment,
    ),
    Domain: executionDomainForTaskQueue(input.taskQueue),
    Trigger: input.trigger,
    ReleaseCommit: input.bootstrap.releaseCommit,
  });
}

export function buildExecutionStartMetadata(input: {
  readonly bootstrap: TemporalBootstrapMetadata;
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
