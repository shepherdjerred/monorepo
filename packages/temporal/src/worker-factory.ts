import { VersioningBehavior } from "@temporalio/common";
import { Worker } from "@temporalio/worker";
import type { NativeConnection } from "@temporalio/worker";
import type { createTemporalWorkerTracing } from "@shepherdjerred/temporal-observability/interceptors";
import type {
  LegacyTemporalNamespace,
  TemporalNamespace,
} from "./shared/temporal-namespace.ts";
import { WORKFLOW_TASK_POLLER_BEHAVIOR } from "./shared/worker-options.ts";
import type { TemporalBootstrap } from "./shared/temporal-bootstrap.ts";
import type { QueueWorkerDefinition } from "./worker-config.ts";

type TemporalWorkerTracing = ReturnType<typeof createTemporalWorkerTracing>;

export type CreateQueueWorkerOptions = {
  readonly connection: NativeConnection;
  readonly workflowsPath: string;
  readonly workflowUiInterceptorPath: string;
  readonly domainTaggingInterceptorPath: string;
  readonly bootstrap: TemporalBootstrap;
  readonly temporalTracing: TemporalWorkerTracing | undefined;
};

export async function createQueueWorker(
  definition: QueueWorkerDefinition,
  options: CreateQueueWorkerOptions,
  namespace: TemporalNamespace | LegacyTemporalNamespace,
  legacyDrain: boolean,
): Promise<Worker> {
  const {
    connection,
    workflowsPath,
    workflowUiInterceptorPath,
    domainTaggingInterceptorPath,
    bootstrap,
    temporalTracing,
  } = options;
  if (definition.kind === "workflow") {
    const workerDeployment = legacyDrain
      ? undefined
      : bootstrap.workerDeployment;
    return await Worker.create({
      connection,
      namespace,
      workflowsPath,
      interceptors: {
        // Keep domain tagging after tracing modules so its span is active.
        workflowModules: [
          workflowUiInterceptorPath,
          ...(temporalTracing?.workflowModules ?? []),
          domainTaggingInterceptorPath,
        ],
      },
      ...(temporalTracing === undefined
        ? {}
        : { sinks: temporalTracing.sinks }),
      workflowTaskPollerBehavior: WORKFLOW_TASK_POLLER_BEHAVIOR,
      taskQueue: definition.taskQueue,
      ...(workerDeployment === undefined
        ? {}
        : {
            workerDeploymentOptions: {
              version: workerDeployment,
              useWorkerVersioning: true,
              defaultVersioningBehavior: VersioningBehavior.AUTO_UPGRADE,
            },
          }),
      ...(!legacyDrain &&
      definition.maxConcurrentWorkflowTaskExecutions === undefined
        ? {}
        : {
            maxConcurrentWorkflowTaskExecutions:
              definition.maxConcurrentWorkflowTaskExecutions ?? 1,
          }),
    });
  }
  return await Worker.create({
    connection,
    namespace,
    activities: definition.activities,
    taskQueue: definition.taskQueue,
    ...(temporalTracing === undefined
      ? {}
      : { interceptors: { activity: temporalTracing.activity } }),
    ...(!legacyDrain &&
    definition.maxConcurrentActivityTaskExecutions === undefined
      ? {}
      : {
          maxConcurrentActivityTaskExecutions:
            definition.maxConcurrentActivityTaskExecutions ?? 1,
        }),
  });
}
