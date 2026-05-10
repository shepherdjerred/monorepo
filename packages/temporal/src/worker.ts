import { Client, Connection } from "@temporalio/client";
import * as Sentry from "@sentry/bun";
import { NativeConnection, Runtime, Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "./shared/task-queues.ts";
import { registerSchedules } from "./schedules/register-schedules.ts";
import { activities } from "./activities/index.ts";
import { startEventBridge } from "./event-bridge/index.ts";
import { initializeTracing, shutdownTracing } from "./observability/tracing.ts";
import {
  startMetricsServer,
  stopMetricsServer,
} from "./observability/metrics.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";
const DEFAULT_METRICS_ADDRESS = "0.0.0.0:9464";

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: "temporal-worker",
      ...fields,
    }),
  );
}

function installRuntime(): void {
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
          worker: "temporal-worker",
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

async function main(): Promise<void> {
  installRuntime();
  initSentry();
  initializeTracing();
  startMetricsServer();

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  jsonLog("info", "Connecting to Temporal server", { address });

  const connection = await NativeConnection.connect({ address });

  const workflowsPath = new URL("workflows/index.ts", import.meta.url).pathname;

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowsPath,
    activities,
  });

  jsonLog("info", "Worker created", { taskQueue: TASK_QUEUES.DEFAULT });

  // Second worker on the pr-review task queue. Same workflow bundle and
  // activity surface, but isolated from the DEFAULT queue so the
  // long-running multi-specialist LLM activities can't head-of-line block
  // HA / cron workflows. See packages/docs/plans/2026-05-10_sota-pr-review-bot.md.
  const prReviewWorker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUES.PR_REVIEW,
    workflowsPath,
    activities,
  });

  jsonLog("info", "Worker created", { taskQueue: TASK_QUEUES.PR_REVIEW });

  const clientConnection = await Connection.connect({ address });
  const client = new Client({ connection: clientConnection });
  await registerSchedules(client);
  jsonLog("info", "Schedules registered");

  const eventBridge = await startEventBridge(client);

  // Guard against double-shutdown. Kubernetes may deliver SIGTERM more than
  // once during pod termination, and the Temporal SDK throws
  // `IllegalStateError: Not running. Current state: DRAINING` if shutdown()
  // is called against a worker that has already begun draining. Tracking
  // this with a flag means subsequent signals are no-ops, and a state check
  // on `worker` covers the case where the worker drained for a non-signal
  // reason (e.g., lost server connection) before SIGTERM arrived.
  let shutdownStarted = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shutdownStarted) {
      jsonLog("info", "Shutdown already in progress, ignoring signal", {
        signal,
      });
      return;
    }
    shutdownStarted = true;
    jsonLog("info", "Shutting down worker", { signal });
    await eventBridge.close();
    const workerState = worker.getState();
    if (workerState === "RUNNING") {
      worker.shutdown();
    } else {
      jsonLog("info", "Worker not RUNNING, skipping worker.shutdown()", {
        state: workerState,
      });
    }
    const prReviewState = prReviewWorker.getState();
    if (prReviewState === "RUNNING") {
      prReviewWorker.shutdown();
    } else {
      jsonLog("info", "pr-review worker not RUNNING, skipping shutdown()", {
        state: prReviewState,
      });
    }
    await stopMetricsServer();
    await shutdownTracing();
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  await Promise.all([worker.run(), prReviewWorker.run()]);
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
