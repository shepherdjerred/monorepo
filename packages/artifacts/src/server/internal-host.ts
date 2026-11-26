import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import type { Services } from "#application/services.ts";
import type { ChangeHub } from "#infrastructure/change-hub.ts";
import { reportError } from "#infrastructure/log.ts";
import { gaugeLines, type Metrics } from "#infrastructure/metrics.ts";
import { LOGIN_HEADER } from "./auth.ts";
import { appRouter } from "./router.ts";
import type { HostClass } from "./rpc.ts";
import type { StreamStats } from "./streams.ts";

export type InternalHostOptions = {
  services: Services;
  hub: ChangeHub;
  stats: StreamStats;
  metrics: Metrics;
};

/**
 * Service DNS inside the cluster: probes, Prometheus and the Temporal worker.
 * It serves `/healthz`, `/readyz`, `/metrics` and `/trpc/maintenance.*` only.
 * A request that carries a Tailscale login came through an ingress proxy, so
 * it is refused here whatever it asks for: this host is never public.
 */
export function createInternalHandler(options: InternalHostOptions) {
  const { services } = options;
  const app = new Hono();

  app.use(async (c, next) => {
    if (c.req.header(LOGIN_HEADER) !== undefined)
      return c.json({ error: "Not found" }, 404);
    await next();
    options.metrics.requests({
      host: "internal",
      route: c.req.path.startsWith("/trpc")
        ? "maintenance"
        : c.req.path.replace("/", "") || "root",
      status: c.res.status,
    });
    return;
  });

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    try {
      await services.deps.db.$queryRaw`SELECT 1`;
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });

  app.get("/metrics", async (c) => {
    const lines = [
      ...options.metrics.lines(),
      ...gaugeLines("artifacts_stream_clients", "Open streams by kind", [
        { labels: { kind: "feedback" }, value: options.stats.feedback },
        { labels: { kind: "events" }, value: options.stats.events },
      ]),
      ...gaugeLines(
        "artifacts_listen_connected",
        "1 while the LISTEN connection is up",
        [{ value: options.hub.listening() ? 1 : 0 }],
      ),
    ];
    try {
      const gauges = await services.maintenance.gauges();
      lines.push(
        ...gaugeLines(
          "artifacts_undelivered_comments",
          "Settled human comments no agent has claimed",
          [{ value: gauges.undeliveredComments }],
        ),
        ...gaugeLines(
          "artifacts_oldest_unhandled_seconds",
          "Age of the oldest unhandled human comment",
          [{ value: gauges.oldestUnhandledSeconds }],
        ),
        ...gaugeLines(
          "artifacts_cleanup_last_success_timestamp_seconds",
          "Unix time of the last successful cleanup, 0 when none",
          [{ value: gauges.cleanupLastSuccessSeconds }],
        ),
      );
    } catch (error) {
      reportError(error, "artifacts_metrics_gauges_failed");
    }
    return c.text(`${lines.join("\n")}\n`, 200, {
      "Content-Type": "text/plain; version=0.0.4",
    });
  });

  const hostClass: HostClass = "internal";
  app.all("/trpc/maintenance.*", (c) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      onError: ({ error }) => {
        if (error.code === "INTERNAL_SERVER_ERROR")
          reportError(error.cause ?? error);
      },
      createContext: () => ({
        requestId: crypto.randomUUID(),
        hostClass,
        caller: null,
        services,
      }),
    }),
  );

  app.all("*", (c) => c.json({ error: "Not found" }, 404));
  return (request: Request) => app.fetch(request);
}
