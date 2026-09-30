/**
 * The probe-and-scrape server for roles that serve no product HTTP surface.
 *
 * `gateway` and `activity-worker` still have to be probeable and scrapable —
 * Kubernetes restarts what it cannot probe, and a pod Prometheus cannot reach
 * is a pod nobody can see fail. What they must NOT do is mount the product
 * surface: tRPC, OAuth, the Explore stream and image rendering belong to one
 * role, and quietly serving a second copy of them from the bot pod is how a
 * "split" deployment ends up with two of everything.
 *
 * So this is deliberately a different module rather than a flag on
 * `server.ts`: the routes a role serves are decided by which server it starts,
 * and there is no configuration under which this one grows a tRPC handler.
 *
 * `handleLivez` / `handleHealthz` are shared with the full server, so a probe
 * answers identically whichever role is behind it.
 */

import * as Sentry from "@sentry/bun";
import configuration from "#src/configuration.ts";
import { handleHealthz, handleLivez } from "#src/http/health-routes.ts";
import { createLogger } from "#src/logger.ts";
import { getMetrics } from "#src/metrics/index.ts";

const logger = createLogger("admin-http");

export type AdminHttpServerRuntime = {
  readonly shutdownHttpServer: () => Promise<void>;
};

async function dispatch(url: URL): Promise<Response> {
  if (url.pathname === "/ping") {
    return new Response("pong", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  if (url.pathname === "/livez") return handleLivez({ cors: {} });
  if (url.pathname === "/healthz") return handleHealthz({ cors: {} });
  if (url.pathname === "/metrics") {
    try {
      return new Response(await getMetrics(), {
        status: 200,
        headers: {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        },
      });
    } catch (error) {
      logger.error("❌ Error generating metrics:", error);
      Sentry.captureException(error, {
        tags: { source: "admin-http-metrics" },
      });
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Bind the admin server on the same port the full server would use, so probe
 * and scrape configuration is identical across every role.
 */
export function startAdminHttpServer(): AdminHttpServerRuntime {
  const server = Bun.serve({
    port: configuration.port,
    hostname: "0.0.0.0",
    fetch: async (request) => await dispatch(new URL(request.url)),
  });
  logger.info(
    `🩺 Admin HTTP server listening on port ${configuration.port.toString()} (health and metrics only)`,
  );
  return {
    shutdownHttpServer: async () => {
      await server.stop();
    },
  };
}
