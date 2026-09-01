import configuration from "#src/configuration.ts";
import { getMetrics } from "#src/metrics/index.ts";
import { handleHealthz, handleLivez } from "#src/http/health-routes.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "#src/trpc/router/index.ts";
import { createContext } from "#src/trpc/context.ts";
import { handleAuthRoutes } from "#src/trpc/auth-web.ts";
import { handleDevLogin } from "#src/trpc/dev-login.ts";
import { prisma } from "#src/database/index.ts";
import { handleImageRoute } from "#src/trpc/image-routes.ts";
import { handleReportAiRoute } from "#src/reports/ai/http-route.ts";
import {
  EXPLORE_STREAM_PATH,
  handleExploreRoute,
} from "#src/explore/http-route.ts";
import { exploreRunManager } from "#src/explore/run-manager.ts";
import { handleVersion } from "#src/http/version.ts";
import { handleTournamentCallback } from "#src/http/tournament-callback.ts";
import {
  classifyMethod,
  classifyRoute,
  statusClass,
} from "#src/http/route-label.ts";
import { httpRequestDuration, httpRequestsTotal } from "#src/metrics/web.ts";
import { handleWeeklyParlayControl } from "#src/http/weekly-parlay-control.ts";
import { handleCustomAuthRoutes } from "#src/customs/activity-auth-http.ts";
import {
  CUSTOMS_SOCKET_PATH,
  customSocketHandlers,
  upgradeCustomSocket,
  type CustomSocketData,
} from "#src/customs/socket.ts";

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
  "SERVICE_UNAVAILABLE",
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

/**
 * Record a served request. Route labels are normalized to a bounded set (see
 * `classifyRoute`) so scanner traffic can't mint unbounded series.
 *
 * `/metrics` is deliberately not timed: `getMetrics()` sweeps the DB on every
 * scrape, so its latency describes our own scrape cost, not user-facing
 * latency. It is still counted, which is what makes scrape failures visible.
 */
async function withHttpMetrics(
  request: Request,
  url: URL,
  handle: () => Promise<Response>,
): Promise<Response> {
  const route = classifyRoute(url.pathname);
  const start = performance.now();
  let status = 500;
  try {
    const response = await handle();
    status = response.status;
    return response;
  } finally {
    httpRequestsTotal.inc({
      route,
      method: classifyMethod(request.method),
      status: status.toString(),
      status_class: statusClass(status),
    });
    if (url.pathname !== "/metrics") {
      httpRequestDuration.observe(
        { route },
        (performance.now() - start) / 1000,
      );
    }
  }
}

/**
 * HTTP server for health checks, metrics, and tRPC API using Bun's native server
 */
const server = Bun.serve<CustomSocketData>({
  port: configuration.port,
  // Bind to loopback whenever dev login is enabled so the unauthenticated
  // /api/dev/login route (which mints a session for any Discord ID) is only
  // reachable from this machine, never from another host on the network. In
  // beta/prod enableDevLogin is false, so the server binds all interfaces to
  // receive ingress traffic as usual.
  hostname: configuration.enableDevLogin ? "127.0.0.1" : "0.0.0.0",
  async fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname === CUSTOMS_SOCKET_PATH) {
      return await upgradeCustomSocket(request, bunServer);
    }
    const response = await withHttpMetrics(request, url, () =>
      dispatch(request, url),
    );
    // Keep Bun's normal idle timeout through body parsing and authentication.
    // Only a successfully authenticated SSE observer may stay quiet while the
    // model reasons between tool calls; the run itself has a bounded timeout.
    if (
      url.pathname === EXPLORE_STREAM_PATH &&
      response.status === 200 &&
      response.headers.get("Content-Type")?.startsWith("text/event-stream") ===
        true
    ) {
      bunServer.timeout(request, 0);
    }
    return response;
  },
  websocket: customSocketHandlers,
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

/**
 * Route dispatch. Extracted from `fetch` so every response flows through
 * {@link withHttpMetrics}, including the 404 fallback and error paths.
 */
async function dispatch(request: Request, url: URL): Promise<Response> {
  const customsAuthResponse = await handleCustomAuthRoutes(request, url);
  if (customsAuthResponse !== null) return customsAuthResponse;

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

  // Liveness probe - restarts the pod on a sustained Riot API or Discord
  // gateway failure
  if (url.pathname === "/livez") {
    return handleLivez({ cors: corsHeadersFor(request) });
  }

  // Readiness probe - checks Riot API health
  if (url.pathname === "/healthz") {
    return handleHealthz({ cors: corsHeadersFor(request) });
  }

  // Build/deploy identity: version, git SHA, tRPC contract hash
  if (url.pathname === "/api/version") {
    return handleVersion(request, corsHeadersFor(request));
  }

  // Riot tournament provider callback.
  //
  // Registering a provider REQUIRES a callback URL, so this endpoint has to
  // exist. It acknowledges and discards, and mutates nothing.
  //
  // That restraint is the point. tournament-v5 has no shared secret and no
  // signature, so the URL is the only credential — a handler that wrote
  // anything would be an unauthenticated injection path into the canonical S3
  // match store. It would also be a second ingest path competing with the
  // match-history cursor, whose S3 write is what gates the cursor advance. And
  // the stub emits no callbacks at all, so none of it could be tested before
  // the key gains tournament access.
  //
  // What it does buy: proof the URL is live if Riot ever validates it at
  // registration, and real latency data (callback arrival vs. games/by-code
  // resolution) to justify promoting this to an accelerator later.
  if (url.pathname === "/api/riot/tournament-callback") {
    return handleTournamentCallback(request);
  }

  // Retained only for Workflow histories that predate the embedded-Activity
  // patch. The route is absent unless its private bootstrap token is present.
  const weeklyParlayResponse = await handleWeeklyParlayControl(request, url);
  if (weeklyParlayResponse !== null) {
    return weeklyParlayResponse;
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

  // Web auth: Discord OAuth start/install/callback/logout — see
  // handleAuthRoutes for the individual routes and their error handling.
  const authResponse = await handleAuthRoutes(request, url);
  if (authResponse !== null) {
    return authResponse;
  }

  // Dev-only instant sign-in (no Discord OAuth round-trip). Gated on BOTH
  // environment=dev AND the explicit, default-off ENABLE_DEV_LOGIN flag, so a
  // beta/prod deploy that omits ENVIRONMENT (which defaults to "dev") still
  // fails closed rather than exposing an unauthenticated session-minting
  // endpoint. Set only by scripts/dev-web.ts.
  if (
    configuration.environment === "dev" &&
    configuration.enableDevLogin &&
    url.pathname === "/api/dev/login"
  ) {
    return await handleDevLogin(request, prisma);
  }

  const reportAiResponse = await handleReportAiRoute(
    request,
    url,
    corsHeadersFor(request),
  );
  if (reportAiResponse !== null) {
    return reportAiResponse;
  }

  // Explore: the SSE run-observer endpoint (session + allowlist) and the
  // unauthenticated shared-transcript read.
  const exploreResponse = await handleExploreRoute(
    request,
    url,
    corsHeadersFor(request),
  );
  if (exploreResponse !== null) {
    return exploreResponse;
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
        // Allow the client to send read queries over POST (methodOverride) so
        // large inputs — e.g. the report preview's up-to-4,000-char ScoutQL —
        // travel in the request body instead of a GET URL that Cloudflare/Caddy
        // could reject for length. Mutations already POST.
        allowMethodOverride: true,
        createContext: () => createContext(request),
        onError({ error, path }) {
          // Log expected client faults at info: they are normal traffic (an
          // anonymous page load, a stale guild) and logging them at error
          // buried the genuine faults in noise. Only real server bugs are
          // logged at error and shipped to Sentry.
          const expected = EXPECTED_CLIENT_ERROR_CODES.has(error.code);
          const description = `tRPC ${error.code} on ${path ?? "unknown"}:`;
          if (expected) {
            logger.info(description, error.message);
          } else {
            logger.error(description, error);
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
}

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
  await exploreRunManager.shutdown();
  await server.stop();
  logger.info("✅ HTTP server shut down successfully");
}
