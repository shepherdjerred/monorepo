import { Client, Connection } from "@temporalio/client";
import { VersioningBehavior } from "@temporalio/common";
import * as Sentry from "@sentry/bun";
import {
  DefaultLogger,
  NativeConnection,
  Runtime,
  Worker,
} from "@temporalio/worker";
import { registerSchedules } from "./schedules/register-schedules.ts";
import {
  startHttpServers,
  type EventBridgeHandle,
} from "./event-bridge/index.ts";
import { startEventBridgeSupervisor } from "./event-bridge/supervisor.ts";
import { initializeTracing, shutdownTracing } from "./observability/tracing.ts";
import {
  startMetricsServer,
  stopMetricsServer,
} from "./observability/metrics.ts";
import { createStructuredLogger } from "./observability/logging.ts";
import { restoreGlitterCorpusSnapshotMetrics } from "./activities/glitter-corpus-snapshot.ts";
import { isTransientCorpusStorageError } from "./activities/glitter-corpus-store.ts";
import { WORKFLOW_TASK_POLLER_BEHAVIOR } from "./shared/worker-options.ts";
import { retryUntilReady } from "./shared/startup-retry.ts";
import { formatError } from "./shared/format-error.ts";
import { parseWorkerRole, type WorkerRole } from "./shared/worker-role.ts";
import {
  parseTemporalBootstrap,
  requireWorkerDeployment,
  type TemporalBootstrap,
} from "./shared/temporal-bootstrap.ts";
import {
  getWorkerRoleContract,
  type QueueWorkerDefinition,
} from "./worker-config.ts";
import { parseTemporalBootstrapMetadata } from "./shared/execution-metadata.ts";
import { ExecutionMetadataClientInterceptor } from "./lib/execution-metadata-client-interceptor.ts";
import {
  createTemporalClientTracingInterceptor,
  createTemporalWorkerTracing,
} from "@shepherdjerred/temporal-observability/interceptors";
import { createValidatedWorkflowSpanSink } from "@shepherdjerred/temporal-observability/workflow-span-sink";
import {
  initializeCallGraphTracing,
  shutdownCallGraphTracing,
} from "./config/call-graph-tracing.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";
const DEFAULT_METRICS_ADDRESS = "0.0.0.0:9464";

const jsonLog = createStructuredLogger();

function installRuntime(role: WorkerRole, bootstrap: TemporalBootstrap): void {
  const metricsAddress =
    Bun.env["TEMPORAL_METRICS_ADDRESS"] ?? DEFAULT_METRICS_ADDRESS;

  Runtime.install({
    logger: new DefaultLogger("INFO", (entry) => {
      const level =
        entry.level === "ERROR"
          ? "error"
          : entry.level === "WARN"
            ? "warning"
            : "info";
      jsonLog(level, entry.message, {
        sdk: "temporal",
        sdkLevel: entry.level,
        metadata: entry.meta,
      });
    }),
    telemetryOptions: {
      logging: {
        forward: {},
        filter: { core: "INFO", other: "WARN" },
      },
      metrics: {
        metricPrefix: "temporal_worker_",
        // The SDK already emits `namespace` and `task_queue` as per-metric
        // labels. Re-declaring them in globalTags produces duplicate label
        // names on each series, which Prometheus rejects with
        // `label name "task_queue" is not unique: invalid sample` and the
        // scrape target reports `up=0`. Keep globalTags to labels the SDK
        // does NOT emit on its own.
        globalTags: {
          worker: `temporal-worker-${role}`,
          worker_role: role,
          temporal_namespace: bootstrap.namespace,
          ...(bootstrap.workerDeployment === undefined
            ? {}
            : {
                worker_deployment_name:
                  bootstrap.workerDeployment.deploymentName,
                worker_build_id: bootstrap.workerDeployment.buildId,
              }),
        },
        prometheus: {
          bindAddress: metricsAddress,
          countersTotalSuffix: true,
          unitSuffix: true,
          useSecondsForDurations: true,
        },
      },
    },
  });

  jsonLog("info", "Temporal runtime metrics enabled", { metricsAddress });
}

function initSentry(): void {
  const dsn = Bun.env["SENTRY_DSN"];
  if (dsn === undefined || dsn === "") {
    return;
  }

  Sentry.init({
    dsn,
    environment: Bun.env["ENVIRONMENT"] ?? "production",
    release: Bun.env["VERSION"],
    // Sentry would otherwise call setGlobalTracerProvider/Propagator/ContextManager
    // before initializeTracing() runs, which makes our NodeSDK.start() collide
    // with the duplicate-registration check and silently fall back to a no-op
    // tracer — no spans reach Tempo. Sentry stays for errors via captureException;
    // performance traces go to Tempo only.
    skipOpenTelemetrySetup: true,
  });
  jsonLog("info", "Sentry initialized");
}

type TemporalWorkerTracing = ReturnType<typeof createTemporalWorkerTracing>;

type CreateQueueWorkerOptions = {
  readonly connection: NativeConnection;
  readonly workflowsPath: string;
  readonly workflowUiInterceptorPath: string;
  readonly bootstrap: TemporalBootstrap;
  readonly temporalTracing: TemporalWorkerTracing | undefined;
};

async function createQueueWorker(
  definition: QueueWorkerDefinition,
  options: CreateQueueWorkerOptions,
): Promise<Worker> {
  const {
    connection,
    workflowsPath,
    workflowUiInterceptorPath,
    bootstrap,
    temporalTracing,
  } = options;
  if (definition.kind === "workflow") {
    const workerDeployment = bootstrap.workerDeployment;
    return await Worker.create({
      connection,
      namespace: bootstrap.namespace,
      workflowsPath,
      interceptors: {
        workflowModules: [
          workflowUiInterceptorPath,
          ...(temporalTracing?.workflowModules ?? []),
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
      ...(definition.maxConcurrentWorkflowTaskExecutions === undefined
        ? {}
        : {
            maxConcurrentWorkflowTaskExecutions:
              definition.maxConcurrentWorkflowTaskExecutions,
          }),
    });
  }
  return await Worker.create({
    connection,
    namespace: bootstrap.namespace,
    activities: definition.activities,
    taskQueue: definition.taskQueue,
    ...(temporalTracing === undefined
      ? {}
      : { interceptors: { activity: temporalTracing.activity } }),
    ...(definition.maxConcurrentActivityTaskExecutions === undefined
      ? {}
      : {
          maxConcurrentActivityTaskExecutions:
            definition.maxConcurrentActivityTaskExecutions,
        }),
  });
}

async function restoreGlitterCorpusMetricsAfterWorkerStart(
  isClosed: () => boolean,
): Promise<void> {
  try {
    const result = await retryUntilReady({
      operation: restoreGlitterCorpusSnapshotMetrics,
      shouldRetry: isTransientCorpusStorageError,
      isClosed,
      onRetry: ({ attempt, delayMs, error }) => {
        jsonLog(
          "error",
          "Glitter corpus snapshot metric restoration failed; retrying",
          {
            attempt,
            delayMs,
            error: formatError(error),
          },
        );
      },
      onEscalate: ({ attempt, error }) => {
        Sentry.captureMessage(
          `Glitter corpus snapshot metric restoration has failed ${String(attempt)} consecutive times (latest error: ${formatError(error)}); still retrying`,
          "warning",
        );
      },
    });
    if (result === "succeeded") {
      jsonLog("info", "Glitter corpus snapshot metric restoration completed");
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog(
      "error",
      "Glitter corpus snapshot metric restoration failed; corpus operations fail closed while other queues continue",
      { error: formatError(error) },
    );
  }
}

async function initializeTemporalTracing(
  role: WorkerRole,
  roleContract: ReturnType<typeof getWorkerRoleContract>,
  namespace: string,
  bootstrapMetadata: ReturnType<typeof parseTemporalBootstrapMetadata>,
) {
  const taskQueues = roleContract.workers.map((worker) => worker.taskQueue);
  const callGraphTracing = await initializeCallGraphTracing({
    environment: bootstrapMetadata.environment,
    workerRole: role,
  });
  const tracingRuntime = initializeTracing({
    environment: bootstrapMetadata.environment,
    namespace,
    taskQueue: taskQueues.join(","),
    workerRole: role,
  });
  if (callGraphTracing && tracingRuntime === undefined) {
    throw new Error(
      "temporal-call-graph-tracing requires TELEMETRY_ENABLED=true",
    );
  }
  const temporalTracing =
    callGraphTracing && tracingRuntime !== undefined
      ? createTemporalWorkerTracing({
          exporter: createValidatedWorkflowSpanSink(
            tracingRuntime.processor,
            tracingRuntime.resource,
          ),
        })
      : undefined;
  return { callGraphTracing, temporalTracing };
}

async function startRoleServices(options: {
  readonly address: string;
  readonly bootstrapMetadata: ReturnType<typeof parseTemporalBootstrapMetadata>;
  readonly callGraphTracing: boolean;
  readonly namespace: string;
  readonly roleContract: ReturnType<typeof getWorkerRoleContract>;
}): Promise<{
  readonly eventBridge?: EventBridgeHandle;
  readonly httpServers?: EventBridgeHandle;
}> {
  if (
    !options.roleContract.runsGateway &&
    !options.roleContract.runsEventBridge
  ) {
    return {};
  }
  const clientConnection = await Connection.connect({
    address: options.address,
  });
  const client = new Client({
    connection: clientConnection,
    namespace: options.namespace,
    interceptors: {
      workflow: [
        new ExecutionMetadataClientInterceptor(options.bootstrapMetadata),
        ...(options.callGraphTracing
          ? [createTemporalClientTracingInterceptor()]
          : []),
      ],
    },
  });
  let httpServers: EventBridgeHandle | undefined;
  if (options.roleContract.runsGateway) {
    await registerSchedules(client, {
      bootstrap: options.bootstrapMetadata,
      validateLocalEnvironment:
        options.roleContract.validatesScheduleEnvironmentLocally,
    });
    jsonLog("info", "Schedules registered");
    httpServers = startHttpServers(client);
  }
  return {
    ...(httpServers === undefined ? {} : { httpServers }),
    ...(options.roleContract.runsEventBridge
      ? { eventBridge: startEventBridgeSupervisor(client) }
      : {}),
  };
}

// `bun run start` (the documented local command, no env file) and a manual
// `docker build` without --build-arg GIT_SHA (which bakes the Dockerfile's
// ARG GIT_SHA=unknown default) both leave these unset or "unknown".
// ReleaseCommitSchema requires an exact 40-character hex SHA and
// ExecutionEnvironmentSchema has no default of its own, so without this the
// worker throws in parseTemporalBootstrapMetadata before it ever connects.
// Kubernetes deployments always set both explicitly, so this never masks a
// real deploy-config bug — only the two local paths above.
function localBootstrapEnvironment(value: string | undefined): string {
  return value ?? "dev";
}

function localReleaseCommit(value: string | undefined): string {
  return value === undefined || value === "unknown"
    ? "0000000000000000000000000000000000000000"
    : value;
}

async function main(): Promise<void> {
  const role = parseWorkerRole(Bun.env["TEMPORAL_WORKER_ROLE"]);
  const bootstrap = parseTemporalBootstrap(Bun.env);
  const roleContract = getWorkerRoleContract(role);
  if (role === "workflows") {
    requireWorkerDeployment(bootstrap);
  }
  const bootstrapMetadata = parseTemporalBootstrapMetadata(
    localBootstrapEnvironment(Bun.env["ENVIRONMENT"]),
    localReleaseCommit(Bun.env["GIT_SHA"]),
  );
  installRuntime(role, bootstrap);
  initSentry();
  const { callGraphTracing, temporalTracing } = await initializeTemporalTracing(
    role,
    roleContract,
    bootstrap.namespace,
    bootstrapMetadata,
  );

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  jsonLog("info", "Connecting to Temporal server", { address, role });

  const connection = await NativeConnection.connect({ address });

  const workflowsPath = new URL("workflows/index.ts", import.meta.url).pathname;
  const workflowUiInterceptorPath = new URL(
    import.meta.resolve("@scout-for-lol/temporal/workflow-ui-interceptor"),
  ).pathname;
  const workers: Worker[] = [];
  for (const definition of roleContract.workers) {
    const worker = await createQueueWorker(definition, {
      connection,
      workflowsPath,
      workflowUiInterceptorPath,
      bootstrap,
      temporalTracing,
    });
    workers.push(worker);
    jsonLog("info", "Worker created", {
      workerKind: definition.kind,
      queueRole: definition.role,
      taskQueue: definition.taskQueue,
      ...(definition.kind === "activity"
        ? {
            maxConcurrentActivityTaskExecutions:
              definition.maxConcurrentActivityTaskExecutions,
          }
        : {
            maxConcurrentWorkflowTaskExecutions:
              definition.maxConcurrentWorkflowTaskExecutions,
          }),
    });
  }

  const { httpServers, eventBridge } = await startRoleServices({
    address,
    bootstrapMetadata,
    callGraphTracing,
    namespace: bootstrap.namespace,
    roleContract,
  });

  // The event-loop-backed health endpoint starts only after every worker in
  // this role has been created and all role-specific startup has completed.
  startMetricsServer();

  // Guard against double-shutdown. Kubernetes may deliver SIGTERM more than
  // once during pod termination, and the Temporal SDK throws
  // `IllegalStateError: Not running. Current state: DRAINING` if shutdown()
  // is called against a worker that has already begun draining. Tracking
  // this with a flag means subsequent signals are no-ops, and a state check
  // on `worker` covers the case where the worker drained for a non-signal
  // reason (e.g., lost server connection) before SIGTERM arrived.
  let shutdownStarted = false;
  let finishControlLifecycle: (() => void) | undefined;
  const controlLifecycle = new Promise<void>((resolve) => {
    finishControlLifecycle = resolve;
  });
  const shutdown = async (signal: string): Promise<void> => {
    if (shutdownStarted) {
      jsonLog("info", "Shutdown already in progress, ignoring signal", {
        signal,
      });
      return;
    }
    shutdownStarted = true;
    jsonLog("info", "Shutting down worker", { signal });
    if (httpServers !== undefined) {
      await httpServers.close();
    }
    if (eventBridge !== undefined) {
      await eventBridge.close();
    }
    for (const roleWorker of workers) {
      const state = roleWorker.getState();
      if (state === "RUNNING") {
        roleWorker.shutdown();
      } else {
        jsonLog("info", "Worker not RUNNING, skipping shutdown()", {
          state,
        });
      }
    }
    await stopMetricsServer();
    await shutdownTracing();
    await shutdownCallGraphTracing();
    finishControlLifecycle?.();
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  const workerRuns = workers.map((roleWorker) => roleWorker.run());
  if (roleContract.restoresGlitterCorpusMetrics) {
    void restoreGlitterCorpusMetricsAfterWorkerStart(() => shutdownStarted);
  }
  if (workerRuns.length === 0) {
    await controlLifecycle;
  } else {
    await Promise.all(workerRuns);
  }
}

void (async () => {
  try {
    await main();
  } catch (error: unknown) {
    Sentry.captureException(error);
    await Sentry.flush(2000);
    jsonLog("error", "Worker failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
})();
