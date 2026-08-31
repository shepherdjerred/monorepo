import { Client, Connection } from "@temporalio/client";
import * as Sentry from "@sentry/bun";
import { DefaultLogger, NativeConnection, Runtime } from "@temporalio/worker";
import type { Worker } from "@temporalio/worker";
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
// Emit worker boot logs to stdout and the tracing provider when enabled.
import { log as jsonLog } from "./observability/log.ts";
import { parseWorkerRole, type WorkerRole } from "./shared/worker-role.ts";
import {
  parseTemporalBootstrap,
  requireWorkerDeployment,
  type TemporalBootstrap,
} from "./shared/temporal-bootstrap.ts";
import { getWorkerRoleContract } from "./worker-config.ts";
import {
  executionDomainForTaskQueue,
  parseTemporalBootstrapMetadata,
} from "./shared/execution-metadata.ts";
import { ExecutionMetadataClientInterceptor } from "./lib/execution-metadata-client-interceptor.ts";
import {
  createTemporalClientTracingInterceptor,
  createTemporalWorkerTracing,
} from "@shepherdjerred/temporal-observability/interceptors";
import { createValidatedWorkflowSpanSink } from "@shepherdjerred/temporal-observability/workflow-span-sink";
import { sanitizeTemporalLogFields } from "@shepherdjerred/temporal-observability/log-fields";
import {
  initializeCallGraphTracing,
  shutdownCallGraphTracing,
} from "./config/call-graph-tracing.ts";
import {
  parseLegacyTemporalNamespace,
  parseTemporalNamespace,
  type LegacyTemporalNamespace,
  type TemporalNamespace,
} from "./shared/temporal-namespace.ts";
import {
  assertCentralWorkerNamespace,
  workerNamespaces,
} from "./shared/worker-namespaces.ts";
import {
  parseScheduleReconciliationMode,
  isScheduleNamespaceDrained,
  type ScheduleReconciliationMode,
} from "./shared/schedule-reconciliation.ts";
import { createQueueWorker } from "./worker-factory.ts";
import { restoreGlitterCorpusMetricsAfterWorkerStart } from "./worker-glitter.ts";
import { restoreSeaweedFsMetricsAfterWorkerStart } from "./observability/restore-startup-metrics.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";
const DEFAULT_METRICS_ADDRESS = "0.0.0.0:9464";

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
        ...sanitizeTemporalLogFields(entry.meta),
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

async function initializeTemporalTracing(
  role: WorkerRole,
  roleContract: ReturnType<typeof getWorkerRoleContract>,
  namespace: string,
  bootstrapMetadata: ReturnType<typeof parseTemporalBootstrapMetadata>,
) {
  const taskQueues = roleContract.workers.map((worker) => worker.taskQueue);
  const soleWorker = roleContract.workers.at(0);
  if (soleWorker === undefined && roleContract.workers.length === 1) {
    throw new Error("Single-worker Temporal role has no Worker configuration");
  }
  const callGraphTracing = await initializeCallGraphTracing({
    environment: bootstrapMetadata.environment,
    workerRole: role,
  });
  const tracingRuntime = initializeTracing({
    domain:
      soleWorker !== undefined && roleContract.workers.length === 1
        ? executionDomainForTaskQueue(soleWorker.taskQueue)
        : "platform",
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

type StartRoleServicesOptions = {
  readonly address: string;
  readonly bootstrapMetadata: ReturnType<typeof parseTemporalBootstrapMetadata>;
  readonly callGraphTracing: boolean;
  readonly namespace: TemporalNamespace;
  readonly scheduleReconciliation: ScheduleReconciliationMode;
  readonly legacyNamespace: LegacyTemporalNamespace | undefined;
  readonly roleContract: ReturnType<typeof getWorkerRoleContract>;
};

async function shouldReconcileSchedules(
  options: StartRoleServicesOptions,
  connection: Connection,
): Promise<boolean> {
  if (options.scheduleReconciliation !== "auto") {
    return options.scheduleReconciliation === "enabled";
  }
  const shouldReconcile =
    options.legacyNamespace === undefined ||
    (await isScheduleNamespaceDrained(
      new Client({
        connection,
        namespace: options.legacyNamespace,
      }),
    ));
  jsonLog(
    "info",
    shouldReconcile
      ? "Legacy schedule namespace drained"
      : "Legacy schedule namespace still active",
    { namespace: options.legacyNamespace ?? "none" },
  );
  return shouldReconcile;
}

async function registerGatewaySchedules(
  options: StartRoleServicesOptions,
  connection: Connection,
): Promise<void> {
  const scheduleNamespaces: readonly TemporalNamespace[] =
    options.namespace === "prod" ? ["prod", "beta"] : [options.namespace];
  for (const scheduleNamespace of scheduleNamespaces) {
    const scheduleClient = new Client({
      connection,
      namespace: scheduleNamespace,
      interceptors: {
        workflow: [
          new ExecutionMetadataClientInterceptor(options.bootstrapMetadata),
          ...(options.callGraphTracing
            ? [createTemporalClientTracingInterceptor()]
            : []),
        ],
      },
    });
    await registerSchedules(scheduleClient, {
      bootstrap: options.bootstrapMetadata,
      namespace: scheduleNamespace,
      validateLocalEnvironment:
        options.roleContract.validatesScheduleEnvironmentLocally,
    });
    jsonLog("info", "Schedules registered", {
      namespace: scheduleNamespace,
    });
  }
}

async function startRoleServices(options: StartRoleServicesOptions): Promise<{
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
  const shouldReconcile = await shouldReconcileSchedules(
    options,
    clientConnection,
  );
  let httpServers: EventBridgeHandle | undefined;
  if (shouldReconcile && options.roleContract.runsGateway) {
    await registerGatewaySchedules(options, clientConnection);
    httpServers = startHttpServers(client);
  } else if (options.roleContract.runsGateway) {
    jsonLog("info", "Schedule reconciliation disabled", {
      namespace: options.namespace,
    });
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
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  assertCentralWorkerNamespace(role, namespace);
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
    namespace,
    bootstrapMetadata,
  );
  // Boot-time-only, resolved once here rather than re-queried per call:
  // client.ts's createTemporalClient() (used by Activities that start other
  // workflows, e.g. deliverAgentTaskReport) reads this so its client carries
  // the same tracing interceptor decision as this process's own Worker,
  // instead of silently never tracing the workflows it starts.
  Bun.env["TEMPORAL_CALL_GRAPH_TRACING"] = callGraphTracing ? "true" : "false";

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const scheduleReconciliation = parseScheduleReconciliationMode(
    Bun.env["TEMPORAL_SCHEDULE_RECONCILIATION"],
  );
  const legacyNamespace = parseLegacyTemporalNamespace(
    Bun.env["TEMPORAL_LEGACY_NAMESPACE"],
  );
  jsonLog("info", "Connecting to Temporal server", {
    address,
    role,
    namespace,
    legacyNamespace,
  });

  const connection = await NativeConnection.connect({ address });

  const workflowsPath = new URL("workflows/index.ts", import.meta.url).pathname;
  const workflowUiInterceptorPath = new URL(
    import.meta.resolve("@scout-for-lol/temporal/workflow-ui-interceptor"),
  ).pathname;
  const domainTaggingInterceptorPath = new URL(
    "lib/workflow-domain-interceptor.ts",
    import.meta.url,
  ).pathname;
  const workers: Worker[] = [];
  for (const definition of roleContract.workers) {
    const namespaces = workerNamespaces({
      queueRole: definition.role,
      taskQueue: definition.taskQueue,
      activeNamespace: namespace,
      legacyNamespace,
    });
    for (const workerNamespace of namespaces) {
      const legacyDrain = workerNamespace === legacyNamespace;
      const worker = await createQueueWorker(
        definition,
        {
          connection,
          workflowsPath,
          workflowUiInterceptorPath,
          domainTaggingInterceptorPath,
          bootstrap,
          temporalTracing,
        },
        workerNamespace,
        legacyDrain,
      );
      workers.push(worker);
      jsonLog("info", "Worker created", {
        namespace: workerNamespace,
        legacyDrain,
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
  }

  const { httpServers, eventBridge } = await startRoleServices({
    address,
    bootstrapMetadata,
    callGraphTracing,
    namespace,
    scheduleReconciliation,
    legacyNamespace,
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
  if (roleContract.restoresSeaweedFsBackupMetrics) {
    void restoreSeaweedFsMetricsAfterWorkerStart(() => shutdownStarted);
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
