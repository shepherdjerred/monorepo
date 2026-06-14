// Initialize observability first - must be before other imports that might throw
import {
  initializeObservability,
  shutdownObservability,
} from "./observability/index.ts";
initializeObservability();

import { captureException } from "./observability/sentry.ts";
import { getConfig } from "./config/index.ts";
import { initDatabase, disconnectPrisma } from "./database/index.ts";
import { logger } from "./observability/logger.ts";
import { agentRegistry } from "./agents/registry.ts";
import { startWorker, stopWorker } from "./queue/worker.ts";
import {
  startCronJobs,
  stopCronJobs,
  recoverMissedJobs,
} from "./adapters/cron.ts";
import { startWebhookServer, stopWebhookServer } from "./adapters/webhook.ts";
import { startDiscord, stopDiscord } from "./discord/client.ts";

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("Shutting down Sentinel...");

  stopCronJobs();
  await stopDiscord();
  stopWebhookServer();
  await stopWorker();
  await disconnectPrisma();
  await shutdownObservability();

  logger.info("Sentinel shutdown complete");
  process.exit(0);
}

async function main(): Promise<void> {
  // Register signal handlers early so signals during startup trigger graceful shutdown
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  logger.info("Starting Sentinel...");

  const config = getConfig();
  logger.info(
    {
      model: config.anthropic.model,
      sentryEnabled: config.sentry.enabled,
      agents: [...agentRegistry.keys()],
    },
    "Configuration loaded",
  );

  await initDatabase();
  logger.info("Database initialized");

  startWorker();
  logger.info("Worker started");

  startCronJobs(agentRegistry);
  logger.info("Cron jobs started");

  await recoverMissedJobs(agentRegistry);
  logger.info("Missed job recovery complete");

  startWebhookServer(config);
  logger.info("Webhook server started");

  if (config.discord == null) {
    logger.info("Discord not configured, skipping");
  } else {
    try {
      await startDiscord(config);
      logger.info("Discord client started");
    } catch (error: unknown) {
      logger.warn(error, "Discord failed to start, continuing without it");
    }
  }

  logger.info("Sentinel ready");
}

try {
  await main();
} catch (error: unknown) {
  logger.error(error, "Fatal error");
  if (error instanceof Error) {
    captureException(error, { operation: "main" });
  }
  await shutdownObservability();
  process.exit(1);
}
