import {
  initializeObservability,
  shutdownObservability,
} from "./observability/index.ts";

initializeObservability();

import { handleMessage } from "./agent-runtime/message-handler.ts";
import { executeIsolatedAgentJob } from "./agent-runtime/job-agent.ts";
import { getCapabilityCatalog } from "./agent-tools/tools/tool-sets.ts";
import { getConfig } from "./config/index.ts";
import {
  initializeDynamicConfig,
  shutdownDynamicConfig,
} from "./config/dynamic.ts";
import { disconnectPrisma } from "./database/index.ts";
import { destroyDiscordClient, getDiscordClient } from "./discord/client.ts";
import { registerEventHandlers } from "./discord/events/index.ts";
import { setMessageHandler } from "./discord/events/message-create.ts";
import { startHealthServer, stopHealthServer } from "./health/server.ts";
import { captureException } from "./observability/sentry.ts";
import {
  isSchedulerStarted,
  startScheduler,
  stopScheduler,
} from "./scheduler/index.ts";
import { setAgentJobRuntimeDependencies } from "./scheduler/jobs/agent-jobs.ts";
import { logger } from "./utils/logger.ts";

let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info("Shutting down Birmel");
  await stopScheduler();
  await stopHealthServer();
  await destroyDiscordClient();
  await disconnectPrisma();
  await shutdownDynamicConfig();
  await shutdownObservability();
  logger.info("Birmel shutdown complete");
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const config = getConfig();
  // Refuse to boot when tool metadata and the executable inventory disagree:
  // that mismatch is how a tool ends up with no timeout or risk class. The
  // router used to force this check by building its catalog; nothing else does.
  const capabilities = getCapabilityCatalog();
  await initializeDynamicConfig({
    log: (message) => {
      logger.warn(message);
    },
  });
  logger.info("Starting Birmel 3.0", {
    model: config.openRouter.model,
    classifierModel: config.openRouter.classifierModel,
    memoryModel: config.openRouter.memoryModel,
    personaEnabled: config.persona.enabled,
    telemetryEnabled: config.telemetry.enabled,
    trustedActorCount: config.authority.trustedUserIds.length,
    registeredToolCount: capabilities.length,
    maxSteps: config.agent.maxSteps,
  });

  const client = getDiscordClient();
  registerEventHandlers(client);
  setMessageHandler(handleMessage);
  startHealthServer({
    port: config.health.port,
    isSchedulerStarted,
  });
  await client.login(config.discord.token);
  setAgentJobRuntimeDependencies({ executeAgent: executeIsolatedAgentJob });
  startScheduler();

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
}

try {
  await main();
} catch (error) {
  logger.error("Fatal Birmel startup error", error);
  if (error instanceof Error) {
    captureException(error, { operation: "main" });
  }
  await shutdown(1);
}
