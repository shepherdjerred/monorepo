import { Client, Connection } from "@temporalio/client";
import * as Sentry from "@sentry/bun";
import { NativeConnection, Runtime, Worker } from "@temporalio/worker";
import { registerSchedules } from "./schedules/register-schedules.ts";
import {
  startEventBridge,
  startHttpServers,
  type EventBridgeHandle,
} from "./event-bridge/index.ts";
import { initializeTracing, shutdownTracing } from "./observability/tracing.ts";
import {
  haEventBridgeConnected,
  haEventBridgeStartFailuresTotal,
  startMetricsServer,
  stopMetricsServer,
} from "./observability/metrics.ts";
import { createStructuredLogger } from "./observability/logging.ts";
import { restoreGlitterCorpusSnapshotMetrics } from "./activities/glitter-corpus-snapshot.ts";
import { isTransientCorpusStorageError } from "./activities/glitter-corpus-store.ts";
import { WORKFLOW_TASK_POLLER_BEHAVIOR } from "./shared/worker-options.ts";
import { retryUntilReady, sleepUnlessClosed } from "./shared/startup-retry.ts";
import { parseWorkerRole, type WorkerRole } from "./shared/worker-role.ts";
import { getWorkerRoleContract } from "./worker-config.ts";
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
import type { QueueWorkerDefinition } from "./worker-config.ts";
import {
  parseScheduleReconciliationMode,
  isScheduleNamespaceDrained,
  type ScheduleReconciliationMode,
} from "./shared/schedule-reconciliation.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";
const DEFAULT_METRICS_ADDRESS = "0.0.0.0:9464";

const jsonLog = createStructuredLogger();

function installRuntime(role: WorkerRole): void {
  const metricsAddress =
    Bun.env["TEMPORAL_METRICS_ADDRESS"] ?? DEFAULT_METRICS_ADDRESS;

  Runtime.install({
    telemetryOptions: {
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function classifyEventBridgeStartFailure(error: unknown): string {
  const message = formatError(error).toLowerCase();
  if (message.includes("websocket") || message.includes("web socket")) {
    return "websocket";
  }
  if (message.includes("ha_url") || message.includes("ha_token")) {
    return "config";
  }
  if (message.includes("401") || message.includes("unauthorized")) {
    return "auth";
  }
  return "unknown";
}

type EventBridgeSupervisorState = {
  closed: boolean;
  currentHandle: EventBridgeHandle | undefined;
};

function workerConcurrency(definition: QueueWorkerDefinition): {
  maxConcurrentActivityTaskExecutions?: number;
  maxConcurrentWorkflowTaskExecutions?: number;
} {
  if (definition.kind === "activity") {
    if (definition.maxConcurrentActivityTaskExecutions === undefined) {
      return {};
    }
    return {
      maxConcurrentActivityTaskExecutions:
        definition.maxConcurrentActivityTaskExecutions,
    };
  }
  if (definition.maxConcurrentWorkflowTaskExecutions === undefined) {
    return {};
  }
  return {
    maxConcurrentWorkflowTaskExecutions:
      definition.maxConcurrentWorkflowTaskExecutions,
  };
}

function isEventBridgeSupervisorClosed(
  state: EventBridgeSupervisorState,
): boolean {
  return state.closed;
}

/** Consecutive start failures before escalating the outage to Sentry. */
const EVENT_BRIDGE_ESCALATION_ATTEMPTS = 10;

async function runEventBridgeSupervisor(
  client: Client,
  state: EventBridgeSupervisorState,
): Promise<void> {
  try {
    let attempt = 0;
    while (!isEventBridgeSupervisorClosed(state)) {
      try {
        const handle = await startEventBridge(client);
        if (isEventBridgeSupervisorClosed(state)) {
          await handle.close();
          return;
        }
        state.currentHandle = handle;
        haEventBridgeConnected.set(1);
        jsonLog("info", "Event bridge started");
        return;
      } catch (error: unknown) {
        attempt += 1;
        const retryDelayMs = Math.min(300_000, 10_000 * attempt);
        const reason = classifyEventBridgeStartFailure(error);
        haEventBridgeConnected.set(0);
        haEventBridgeStartFailuresTotal.inc({ reason });
        // Escalate once per outage: the retry loop is intentionally eternal,
        // which previously meant a permanently-down bridge (no HA presence
        // signals, no webhooks) only ever showed up as stderr lines and a
        // gauge nobody was alerting on. Ten consecutive failures ≈ 9 minutes
        // of outage — loud enough for Sentry, once (attempt only grows
        // within a single outage; success exits the loop).
        if (attempt === EVENT_BRIDGE_ESCALATION_ATTEMPTS) {
          Sentry.captureMessage(
            `Event bridge has failed to start ${String(attempt)} consecutive times (latest reason: ${reason}); still retrying`,
            "warning",
          );
        }
        jsonLog("error", "Event bridge failed to start; retrying", {
          attempt,
          reason,
          retryDelayMs,
          error: formatError(error),
        });
        await sleepUnlessClosed(retryDelayMs, () =>
          isEventBridgeSupervisorClosed(state),
        );
      }
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    jsonLog("error", "Event bridge supervisor stopped unexpectedly", {
      error: formatError(error),
    });
  }
}

function startEventBridgeSupervisor(client: Client): EventBridgeHandle {
  const state: EventBridgeSupervisorState = {
    closed: false,
    currentHandle: undefined,
  };

  void runEventBridgeSupervisor(client, state);

  return {
    async close() {
      state.closed = true;
      if (state.currentHandle !== undefined) {
        await state.currentHandle.close();
      }
    },
  };
}

async function createDefinitionWorker(input: {
  connection: NativeConnection;
  definition: QueueWorkerDefinition;
  workflowsPath: string;
  namespace: TemporalNamespace | LegacyTemporalNamespace;
  legacyDrain: boolean;
}): Promise<Worker> {
  if (input.definition.kind === "workflow") {
    return await Worker.create({
      connection: input.connection,
      workflowsPath: input.workflowsPath,
      workflowTaskPollerBehavior: WORKFLOW_TASK_POLLER_BEHAVIOR,
      namespace: input.namespace,
      taskQueue: input.definition.taskQueue,
      ...(!input.legacyDrain &&
      input.definition.maxConcurrentWorkflowTaskExecutions === undefined
        ? {}
        : {
            maxConcurrentWorkflowTaskExecutions:
              input.definition.maxConcurrentWorkflowTaskExecutions ?? 1,
          }),
    });
  }
  return await Worker.create({
    connection: input.connection,
    namespace: input.namespace,
    activities: input.definition.activities,
    taskQueue: input.definition.taskQueue,
    ...(!input.legacyDrain &&
    input.definition.maxConcurrentActivityTaskExecutions === undefined
      ? {}
      : {
          maxConcurrentActivityTaskExecutions:
            input.definition.maxConcurrentActivityTaskExecutions ?? 1,
        }),
  });
}

async function createRoleWorkers(input: {
  connection: NativeConnection;
  definitions: readonly QueueWorkerDefinition[];
  activeNamespace: TemporalNamespace;
  legacyNamespace: LegacyTemporalNamespace | undefined;
}): Promise<Worker[]> {
  const workers: Worker[] = [];
  const workflowsPath = new URL("workflows/index.ts", import.meta.url).pathname;
  for (const definition of input.definitions) {
    const namespaces = workerNamespaces({
      queueRole: definition.role,
      activeNamespace: input.activeNamespace,
      legacyNamespace: input.legacyNamespace,
    });
    for (const namespace of namespaces) {
      const legacyDrain = namespace === input.legacyNamespace;
      const worker = await createDefinitionWorker({
        connection: input.connection,
        definition,
        workflowsPath,
        namespace,
        legacyDrain,
      });
      workers.push(worker);
      jsonLog("info", "Worker created", {
        namespace,
        legacyDrain,
        queueRole: definition.role,
        taskQueue: definition.taskQueue,
        ...workerConcurrency(definition),
      });
    }
  }
  return workers;
}

async function startControlSurfaces(input: {
  address: string;
  namespace: TemporalNamespace;
  scheduleReconciliation: ScheduleReconciliationMode;
  legacyNamespace: LegacyTemporalNamespace | undefined;
  roleContract: ReturnType<typeof getWorkerRoleContract>;
}): Promise<{
  httpServers: EventBridgeHandle | undefined;
  eventBridge: EventBridgeHandle | undefined;
}> {
  if (!input.roleContract.runsGateway && !input.roleContract.runsEventBridge) {
    return { httpServers: undefined, eventBridge: undefined };
  }

  const connection = await Connection.connect({ address: input.address });
  const client = new Client({
    connection,
    namespace: input.namespace,
  });

  let shouldReconcileSchedules = input.scheduleReconciliation === "enabled";
  if (input.scheduleReconciliation === "auto") {
    shouldReconcileSchedules =
      input.legacyNamespace === undefined ||
      (await isScheduleNamespaceDrained(
        new Client({
          connection,
          namespace: input.legacyNamespace,
        }),
      ));
    jsonLog(
      "info",
      shouldReconcileSchedules
        ? "Legacy schedule namespace drained"
        : "Legacy schedule namespace still active",
      { namespace: input.legacyNamespace ?? "none" },
    );
  }

  let httpServers: EventBridgeHandle | undefined;
  if (shouldReconcileSchedules && input.roleContract.runsGateway) {
    const scheduleNamespaces: readonly TemporalNamespace[] =
      input.namespace === "prod" ? ["prod", "beta"] : [input.namespace];
    for (const namespace of scheduleNamespaces) {
      const scheduleClient = new Client({ connection, namespace });
      await registerSchedules(scheduleClient, {
        namespace,
        validateLocalEnvironment:
          input.roleContract.validatesScheduleEnvironmentLocally,
      });
      jsonLog("info", "Schedules registered", { namespace });
    }
    httpServers = startHttpServers(client);
  } else if (input.roleContract.runsGateway) {
    jsonLog("info", "Schedule reconciliation disabled", {
      namespace: input.namespace,
    });
    httpServers = startHttpServers(client);
  }

  return {
    httpServers,
    eventBridge: input.roleContract.runsEventBridge
      ? startEventBridgeSupervisor(client)
      : undefined,
  };
}

async function main(): Promise<void> {
  const role = parseWorkerRole(Bun.env["TEMPORAL_WORKER_ROLE"]);
  const roleContract = getWorkerRoleContract(role);
  installRuntime(role);
  initSentry();
  initializeTracing();

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  const scheduleReconciliation = parseScheduleReconciliationMode(
    Bun.env["TEMPORAL_SCHEDULE_RECONCILIATION"],
  );
  assertCentralWorkerNamespace(role, namespace);
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

  const workers = await createRoleWorkers({
    connection,
    definitions: roleContract.workers,
    activeNamespace: namespace,
    legacyNamespace,
  });
  const { httpServers, eventBridge } = await startControlSurfaces({
    address,
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
