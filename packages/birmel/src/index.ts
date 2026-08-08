import {
  initializeObservability,
  shutdownObservability,
} from "./observability/index.ts";

initializeObservability();

import { handleMessage } from "./agent-runtime/message-handler.ts";
import { executeIsolatedAgentJob } from "./agent-runtime/job-agent.ts";
import { getConfig } from "./config/index.ts";
import { disconnectPrisma } from "./database/index.ts";
import { destroyDiscordClient, getDiscordClient } from "./discord/client.ts";
import { registerEventHandlers } from "./discord/events/index.ts";
import { setMessageHandler } from "./discord/events/message-create.ts";
import { startOAuthServer, stopOAuthServer } from "./editor/oauth-server.ts";
import { startHealthServer, stopHealthServer } from "./health/server.ts";
import { destroyMusicPlayer, initializeMusicPlayer } from "./music/player.ts";
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
  await stopOAuthServer();
  await destroyMusicPlayer();
  await destroyDiscordClient();
  await disconnectPrisma();
  await shutdownObservability();
  logger.info("Birmel shutdown complete");
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const config = getConfig();
  logger.info("Starting Birmel 3.0", {
    model: config.openai.model,
    classifierModel: config.openai.classifierModel,
    memoryModel: config.openai.memoryModel,
    personaEnabled: config.persona.enabled,
    telemetryEnabled: config.telemetry.enabled,
    trustedActorCount: config.authority.trustedUserIds.length,
  });

  const client = getDiscordClient();
  registerEventHandlers(client);
  setMessageHandler(handleMessage);
  startHealthServer({
    port: config.health.port,
    isSchedulerStarted,
  });
  await client.login(config.discord.token);
  await initializeMusicPlayer();
  setAgentJobRuntimeDependencies({ executeAgent: executeIsolatedAgentJob });
  startScheduler();
  await startOAuthServer();

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
