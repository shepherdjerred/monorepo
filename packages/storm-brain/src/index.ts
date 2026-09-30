import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { createBrainApp, createBrainLogger } from "./app.ts";
import { createBrain } from "./brain.ts";
import { loadBrainConfig } from "./config.ts";
import {
  createFlowFlags,
  initBrainFlags,
  shutdownBrainFlags,
} from "./flags.ts";
import { createBrainMetrics, createMetricsHandler } from "./metrics.ts";

const logger = createBrainLogger();
const metrics = createBrainMetrics();
await initBrainFlags((message) => {
  logger.warn(`Feature flags failed to initialize: ${message}`);
});

const config = await loadBrainConfig({
  flagSource: createFlagConfigSource({
    targetingKey: "storm-brain",
    kinds: { model: "string" },
  }),
});
const brain = createBrain({
  model: config.model,
  timeoutMs: config.llmTimeoutMs,
});

const app = createBrainApp(config, {
  brain,
  flags: createFlowFlags(),
  logger,
  metrics,
});

const appServer = Bun.serve({ port: config.port, fetch: app.fetch });
const metricsServer = Bun.serve({
  port: config.metricsPort,
  fetch: createMetricsHandler(metrics.register),
});

logger.info("Storm brain listening", {
  metricsPort: metricsServer.port,
  model: config.model,
  port: appServer.port,
});

async function shutdown(): Promise<void> {
  await shutdownBrainFlags();
  await appServer.stop();
  await metricsServer.stop();
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
