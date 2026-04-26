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
        globalTags: {
          temporal_namespace: "default",
          task_queue: TASK_QUEUES.DEFAULT,
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

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowsPath: new URL("workflows/index.ts", import.meta.url).pathname,
    activities,
  });

  jsonLog("info", "Worker created", { taskQueue: TASK_QUEUES.DEFAULT });

  const clientConnection = await Connection.connect({ address });
  const client = new Client({ connection: clientConnection });
  await registerSchedules(client);
  jsonLog("info", "Schedules registered");

  const eventBridge = await startEventBridge(client);

  const shutdown = async (): Promise<void> => {
    jsonLog("info", "Shutting down worker");
    await eventBridge.close();
    worker.shutdown();
    await stopMetricsServer();
    await shutdownTracing();
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  await worker.run();
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
