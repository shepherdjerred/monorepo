import configuration from "#src/configuration.ts";
import { getMetrics, getRiotApiHealth } from "#src/metrics/index.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "#src/trpc/router/index.ts";
import { createContext } from "#src/trpc/context.ts";
import {
  handleDiscordCallback,
  handleDiscordInstall,
  handleDiscordStart,
  handleWebLogout,
} from "#src/trpc/auth-web.ts";
import { handleImageRoute } from "#src/trpc/image-routes.ts";
import { handleReportAiRoute } from "#src/reports/ai/http-route.ts";

const logger = createLogger("http-server");

logger.info("🌐 Initializing HTTP server");

/**
 * tRPC error codes that represent expected client/user faults (bad input,
 * auth, not-found, rate limits) rather than server bugs. These are surfaced to
 * the caller as 4xx responses but must NOT be shipped to Sentry/Bugsink — they
 * are noise (e.g. a stale guild that the user just left → FORBIDDEN, a
 * malformed channelId or unparseable report query → BAD_REQUEST). Only genuine
 * server faults (INTERNAL_SERVER_ERROR and other 5xx codes) are real bugs.
 */
const EXPECTED_CLIENT_ERROR_CODES = new Set<string>([
  "PARSE_ERROR",
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_SUPPORTED",
  "TIMEOUT",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
  "CLIENT_CLOSED_REQUEST",
]);

/**
 * CORS headers for API responses.
 *
 * We only emit CORS headers when the request's `Origin` matches the
 * configured web-app origin (i.e. the SPA). For every other caller — Tauri
 * desktop clients, server-to-server traffic, or anything cross-origin — we
 * return no CORS headers at all. Browsers refuse the response, which is
 * what we want for cross-origin browser callers; non-browser clients
 * ignore CORS entirely.
 *
 * `Authorization` is intentionally NOT in `Access-Control-Allow-Headers`:
 * the SPA uses cookies + X-CSRF-Token, and the desktop client isn't a
 * browser. Add it back deliberately if a future browser flow needs Bearer.
 */
function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowedOrigin = configuration.webAppOrigin;
  if (
    origin !== null &&
    allowedOrigin !== undefined &&
    origin === allowedOrigin
  ) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  }
  return {};
}

const applicationStartTime = Date.now();

function handleLivez(request: Request): Response {
  const { lastSuccessTimestamp, lastAttemptTimestamp } = getRiotApiHealth();
  const now = Date.now();
  const uptimeMs = now - applicationStartTime;
  const cors = corsHeadersFor(request);

  // Grace period: first 5 minutes after startup, always healthy
  const startupGracePeriodMs = 5 * 60 * 1000;
  if (uptimeMs < startupGracePeriodMs) {
    return Response.json(
      { healthy: true, reason: "startup-grace-period", uptimeMs },
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...cors },
      },
    );
  }

  // After grace: unhealthy if API attempts exist in last 20 min AND last success >15 min ago
  const twentyMinutesMs = 20 * 60 * 1000;
  const fifteenMinutesMs = 15 * 60 * 1000;
  const hasRecentAttempts =
    lastAttemptTimestamp !== undefined &&
    now - lastAttemptTimestamp < twentyMinutesMs;
  const lastSuccessStale =
    lastSuccessTimestamp === undefined ||
    now - lastSuccessTimestamp > fifteenMinutesMs;
  const healthy = !(hasRecentAttempts && lastSuccessStale);

  return Response.json(
    {
      healthy,
      lastSuccessTimestamp: lastSuccessTimestamp ?? null,
      lastAttemptTimestamp: lastAttemptTimestamp ?? null,
      uptimeMs,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}

function handleHealthz(request: Request): Response {
  const { lastSuccessTimestamp, lastAttemptTimestamp } = getRiotApiHealth();
  const now = Date.now();
  const uptimeSeconds = (now - applicationStartTime) / 1000;
  const cors = corsHeadersFor(request);

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

  return Response.json(
    {
      healthy,
      lastSuccessTimestamp: lastSuccessTimestamp ?? null,
      lastAttemptTimestamp: lastAttemptTimestamp ?? null,
      uptimeSeconds,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Content-Type": "application/json", ...cors },
    },
  );
}

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
        headers: corsHeadersFor(request),
      });
    }

    // Startup probe - simple process alive check
    if (url.pathname === "/ping") {
      return new Response("pong", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          ...corsHeadersFor(request),
        },
      });
    }

    // Liveness probe - restarts pod on sustained API failure
    if (url.pathname === "/livez") {
      return handleLivez(request);
    }

    // Readiness probe - checks Riot API health
    if (url.pathname === "/healthz") {
      return handleHealthz(request);
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

    // Web auth: kick off Discord OAuth (sets the state cookie + 302)
    if (url.pathname === "/api/auth/discord/start") {
      try {
        return handleDiscordStart(request);
      } catch (error) {
        logger.error("❌ OAuth start error:", error);
        Sentry.captureException(error, { tags: { source: "auth-web-start" } });
        return new Response("OAuth start failed", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }

    // Bot install: 302 to Discord's add-to-server screen for a
    // signed-in admin, returning to /app/installed with guild_id.
    if (url.pathname === "/api/discord/install") {
      try {
        return await handleDiscordInstall(request);
      } catch (error) {
        logger.error("❌ Bot install redirect error:", error);
        Sentry.captureException(error, {
          tags: { source: "auth-web-install" },
        });
        return new Response("Bot install redirect failed", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }

    // Web auth: Discord OAuth callback
    if (url.pathname === "/api/auth/discord/callback") {
      try {
        return await handleDiscordCallback(request);
      } catch (error) {
        logger.error("❌ OAuth callback error:", error);
        Sentry.captureException(error, {
          tags: { source: "auth-web-callback" },
        });
        return new Response("OAuth callback failed", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }

    // Web auth: logout
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return handleWebLogout(request);
    }

    const reportAiResponse = await handleReportAiRoute(
      request,
      url,
      corsHeadersFor(request),
    );
    if (reportAiResponse !== null) {
      return reportAiResponse;
    }

    // Generated chart PNGs for the web app (<img src>), cookie-authorized.
    const imageResponse = await handleImageRoute(
      request,
      url,
      corsHeadersFor(request),
    );
    if (imageResponse !== null) {
      return imageResponse;
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
            // Only report genuine server faults; expected client errors (bad
            // input, auth, not-found, rate limits) are not bugs.
            if (!EXPECTED_CLIENT_ERROR_CODES.has(error.code)) {
              Sentry.captureException(error, {
                tags: { source: "trpc", path },
              });
            }
          },
        });

        // Add CORS headers to tRPC response
        const headers = new Headers(response.headers);
        Object.entries(corsHeadersFor(request)).forEach(([key, value]) => {
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
            ...corsHeadersFor(request),
          },
        });
      }
    }

    // 404 for all other routes
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
        ...corsHeadersFor(request),
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

const port = server.port?.toString() ?? "unknown";
logger.info(`✅ HTTP server started on http://0.0.0.0:${port}`);
logger.info(`🏥 Startup: http://0.0.0.0:${port}/ping`);
logger.info(`🏥 Liveness: http://0.0.0.0:${port}/livez`);
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
