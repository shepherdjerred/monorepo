import { createBroadcastApp, createBroadcastLogger } from "./app.ts";
import { createBroadcastArchiveStore } from "./archive.ts";
import { loadBroadcastConfig } from "./config.ts";
import { createTempoForwarder } from "./forwarder.ts";
import { createBroadcastMetrics, createMetricsHandler } from "./metrics.ts";

const config = loadBroadcastConfig();
const logger = createBroadcastLogger();
const metrics = createBroadcastMetrics();
const app = createBroadcastApp(config, {
  archive: createBroadcastArchiveStore(config.archive),
  forwarder: createTempoForwarder(config.tempoOtlpHttpUrl),
  logger,
  metrics,
});

const appServer = Bun.serve({ port: config.port, fetch: app.fetch });
const metricsServer = Bun.serve({
  port: config.metricsPort,
  fetch: createMetricsHandler(metrics.register),
});

logger.info("OpenRouter Broadcast ingest listening", {
  metricsPort: metricsServer.port,
  port: appServer.port,
  tempoOtlpHttpUrl: config.tempoOtlpHttpUrl,
});

function shutdown(): void {
  void appServer.stop();
  void metricsServer.stop();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
