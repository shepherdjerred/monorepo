import { VersioningBehavior } from "@temporalio/common";
import {
  DefaultLogger,
  NativeConnection,
  Runtime,
  Worker,
} from "@temporalio/worker";
import { scoutTaskQueues } from "@scout-for-lol/temporal";
import { createLogger } from "#src/logger.ts";
import { parseScoutWorkflowWorkerConfiguration } from "./workflow-worker-config.ts";

const logger = createLogger("scout-workflow-worker");

function structuredSdkLogger(): DefaultLogger {
  return new DefaultLogger("INFO", (entry) => {
    logger.info(entry.message, {
      sdkLevel: entry.level.toLowerCase(),
      ...(entry.meta === undefined ? {} : { temporal: entry.meta }),
    });
  });
}

async function main(): Promise<void> {
  const config = parseScoutWorkflowWorkerConfiguration(Bun.env);
  Runtime.install({
    logger: structuredSdkLogger(),
    telemetryOptions: {
      metrics: {
        metricPrefix: "temporal_worker_",
        globalTags: {
          worker: `scout-${config.stage}-workflows`,
          worker_role: "workflows",
          environment: config.stage,
          temporal_namespace: config.namespace,
          worker_deployment_name: config.deploymentName,
          worker_build_id: config.buildId,
        },
        prometheus: {
          bindAddress: config.metricsAddress,
          countersTotalSuffix: true,
          unitSuffix: true,
          useSecondsForDurations: true,
        },
      },
    },
  });

  const connection = await NativeConnection.connect({
    address: config.address,
  });
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.namespace,
      taskQueue: scoutTaskQueues(config.stage).workflow,
      workflowTaskPollerBehavior: {
        type: "simple-maximum",
        maximum: 10,
      },
      workflowsPath: new URL(
        import.meta.resolve("@scout-for-lol/temporal/workflows"),
      ).pathname,
      maxConcurrentWorkflowTaskExecutions: 4,
      workerDeploymentOptions: {
        version: {
          deploymentName: config.deploymentName,
          buildId: config.buildId,
        },
        useWorkerVersioning: true,
        defaultVersioningBehavior: VersioningBehavior.AUTO_UPGRADE,
      },
    });

    let shutdownRequested = false;
    const shutdown = (signal: "SIGINT" | "SIGTERM"): void => {
      if (shutdownRequested) return;
      shutdownRequested = true;
      logger.info("Scout Workflow Worker shutdown requested", { signal });
      worker.shutdown();
    };
    process.on("SIGINT", () => {
      shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      shutdown("SIGTERM");
    });

    logger.info("Scout Workflow Worker started", {
      stage: config.stage,
      namespace: config.namespace,
      taskQueue: scoutTaskQueues(config.stage).workflow,
      deploymentName: config.deploymentName,
      buildId: config.buildId,
    });
    await worker.run();
  } finally {
    await connection.close();
  }
}

try {
  await main();
} catch (error: unknown) {
  logger.error("Scout Workflow Worker failed", error);
  process.exitCode = 1;
}
