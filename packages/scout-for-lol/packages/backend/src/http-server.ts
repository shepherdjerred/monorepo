import configuration from "@scout-for-lol/backend/configuration.ts";
import {
  getMetrics,
  getRiotApiHealth,
} from "@scout-for-lol/backend/metrics/index.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@scout-for-lol/backend/trpc/router/index.ts";
import { createContext } from "@scout-for-lol/backend/trpc/context.ts";

const logger = createLogger("http-server");

logger.info("🌐 Initializing HTTP server");

/**
 * CORS headers for API responses
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * HTTP server for health checks, metrics, and tRPC API using Bun's native server
 */
const server = Bun.serve({
  port: configuration.port,
  hostname: "0.0.0.0",
  async fetch(request) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Liveness probe - simple process alive check
    if (url.pathname === "/ping") {
      return new Response("pong", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          ...corsHeaders,
        },
      });
    }

    // Readiness probe - checks Riot API health
    if (url.pathname === "/healthz") {
      const { lastSuccessTimestamp, lastAttemptTimestamp } = getRiotApiHealth();
      const now = Date.now();
      const uptimeSeconds = (now - applicationStartTime) / 1000;

      // Unhealthy if: API attempts exist in last 10 minutes AND last success was >5 minutes ago
      const tenMinutesMs = 10 * 60 * 1000;
      const fiveMinutesMs = 5 * 60 * 1000;
      const hasRecentAttempts =
        lastAttemptTimestamp !== undefined &&
        now - lastAttemptTimestamp < tenMinutesMs;
      const lastSuccessStale =
        lastSuccessTimestamp === undefined ||
        now - lastSuccessTimestamp > fiveMinutesMs;
      const healthy = !(hasRecentAttempts && lastSuccessStale);

      return new Response(
        JSON.stringify({
          healthy,
          lastSuccessTimestamp: lastSuccessTimestamp ?? null,
          lastAttemptTimestamp: lastAttemptTimestamp ?? null,
          uptimeSeconds,
        }),
        {
          status: healthy ? 200 : 503,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }

    // Metrics endpoint for Prometheus
    if (url.pathname === "/metrics") {
      try {
        const metrics = await getMetrics();
        return new Response(metrics, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          },
        });
      } catch (error) {
        logger.error("❌ Error generating metrics:", error);
        Sentry.captureException(error, {
          tags: { source: "http-server-metrics" },
        });
        return new Response("Internal Server Error", {
          status: 500,
          headers: {
            "Content-Type": "text/plain",
          },
        });
      }
    }

    // tRPC API endpoint
    if (url.pathname.startsWith("/trpc")) {
      try {
        const response = await fetchRequestHandler({
          endpoint: "/trpc",
          req: request,
          router: appRouter,
          createContext: () => createContext(request),
          onError({ error, path }) {
            logger.error(`tRPC error on ${path ?? "unknown"}:`, error);
            if (error.code !== "UNAUTHORIZED" && error.code !== "NOT_FOUND") {
              Sentry.captureException(error, {
                tags: { source: "trpc", path },
              });
            }
          },
        });

        // Add CORS headers to tRPC response
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          headers.set(key, value);
        });

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        logger.error("❌ tRPC request error:", error);
        Sentry.captureException(error, {
          tags: { source: "http-server-trpc" },
        });
        return new Response("Internal Server Error", {
          status: 500,
          headers: {
            "Content-Type": "text/plain",
            ...corsHeaders,
          },
        });
      }
    }

    // 404 for all other routes
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
        ...corsHeaders,
      },
    });
  },
  error(error) {
    logger.error("❌ HTTP server error:", error);
    Sentry.captureException(error, { tags: { source: "http-server" } });
    return new Response("Internal Server Error", {
      status: 500,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  },
});

const applicationStartTime = Date.now();

const port = server.port?.toString() ?? "unknown";
logger.info(`✅ HTTP server started on http://0.0.0.0:${port}`);
logger.info(`🏥 Liveness: http://0.0.0.0:${port}/ping`);
logger.info(`🏥 Readiness: http://0.0.0.0:${port}/healthz`);
logger.info(`📊 Metrics endpoint: http://0.0.0.0:${port}/metrics`);
logger.info(`🔌 tRPC API: http://0.0.0.0:${port}/trpc`);

/**
 * Gracefully shut down the HTTP server
 */
export async function shutdownHttpServer(): Promise<void> {
  logger.info("🛑 Shutting down HTTP server");
  await server.stop();
  logger.info("✅ HTTP server shut down successfully");
}
