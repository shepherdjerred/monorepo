import { TASK_QUEUES } from "#shared/task-queues.ts";

export const glitterCorpusActivityRetry = {
  maximumAttempts: 3,
  initialInterval: "10 seconds",
  backoffCoefficient: 2,
  maximumInterval: "2 minutes",
} as const;

export const glitterCorpusActivityOptions = {
  taskQueue: TASK_QUEUES.GLITTER_CORPUS,
  startToCloseTimeout: "1 hour",
  retry: glitterCorpusActivityRetry,
} as const;

export const glitterCorpusFinalizerActivityOptions = {
  ...glitterCorpusActivityOptions,
  heartbeatTimeout: "60 seconds",
} as const;
