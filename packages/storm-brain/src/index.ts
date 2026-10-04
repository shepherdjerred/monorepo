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
import { isEnabled } from "@shepherdjerred/feature-flags";
import { ConversationBudget } from "./conversation-budget.ts";
import { createConversation } from "./conversation.ts";

const logger = createBrainLogger();
const metrics = createBrainMetrics();
await initBrainFlags((message) => {
  logger.warn(`Feature flags failed to initialize: ${message}`);
});

const config = await loadBrainConfig({
  flagSource: createFlagConfigSource({
    targetingKey: "storm-brain",
    kinds: { model: "string", conversationModel: "string" },
  }),
});
const brain = createBrain({
  model: config.model,
  timeoutMs: config.llmTimeoutMs,
});

const budgetPath = Bun.env["STORM_COMPANION_BUDGET_DB"];
if (budgetPath === undefined || budgetPath.trim() === "")
  throw new Error("STORM_COMPANION_BUDGET_DB is required durable storage");
const conversationBudget = new ConversationBudget(budgetPath);
const app = createBrainApp(config, {
  brain,
  flags: createFlowFlags(),
  logger,
  metrics,
  conversation: {
    enabled: async () => {
      const result = await isEnabled("storm-brain-conversation-enabled", {
        default: false,
        targetingKey: "storm-brain",
      });
      return result.value;
    },
    decide: createConversation(config.conversationModel, conversationBudget),
  },
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
  conversationBudget.close();
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
