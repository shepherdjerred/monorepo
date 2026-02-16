import type { TServiceParams } from "@digital-alchemy/core";
import { Gauge } from "prom-client";
import { registry, setConnectionChecker } from "./metrics.ts";

const websocketConnected = new Gauge({
  name: "ha_websocket_connected",
  help: "Whether the HA websocket is connected (1=connected, 0=disconnected)",
  registers: [registry],
});

/**
 * Starts an HTTP server to expose Prometheus metrics
 */
export function startMetricsServer({ logger, hass }: TServiceParams) {
  const port = Number.parseInt(Bun.env["METRICS_PORT"] ?? "9090", 10);

  setConnectionChecker(() => hass.socket.connectionState === "connected");

  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/metrics") {
        websocketConnected.set(hass.socket.connectionState === "connected" ? 1 : 0);
        const metrics = await registry.metrics();
        return new Response(metrics, {
          headers: {
            "Content-Type": registry.contentType,
          },
        });
      }

      if (url.pathname === "/health") {
        const connectionState = hass.socket.connectionState;
        const isHealthy = connectionState === "connected";
        return new Response(JSON.stringify({ status: isHealthy ? "healthy" : "unhealthy", connectionState }), {
          status: isHealthy ? 200 : 503,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  logger.info(`Metrics server started on port ${String(port)}`);
  logger.info(`Metrics endpoint: http://localhost:${String(port)}/metrics`);
  logger.info(`Health endpoint: http://localhost:${String(port)}/health`);

  return server;
}
