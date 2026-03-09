import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import { getQueueStats } from "@shepherdjerred/sentinel/queue/index.ts";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { appRouter } from "@shepherdjerred/sentinel/trpc/router/index.ts";
import { createContext } from "@shepherdjerred/sentinel/trpc/context.ts";
import { addSSEListener } from "@shepherdjerred/sentinel/sse/index.ts";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  getRecord,
  getString,
  parseJsonBody,
  readBody,
  verifyTokenEqual,
  verifyWebhookSignature,
} from "./webhook-utils.ts";
import {
  handleBugsinkEvent,
  handleBuildkiteBuild,
  handleCheckSuite,
  handlePagerDutyEvent,
  handleWorkflowRun,
} from "./webhook-handlers.ts";

const webhookLogger = logger.child({ module: "webhook" });

let server: ReturnType<typeof Bun.serve> | null = null;

export function createApp(config: Config): Hono {
  const app = new Hono();

  app.get("/livez", (c) => c.text("ok"));

  app.get("/healthz", async (c) => {
    try {
      const prisma = getPrisma();
      await prisma.$queryRawUnsafe("SELECT 1");
      return c.text("ok");
    } catch (error: unknown) {
      webhookLogger.error({ error }, "Health check failed");
      return c.text("unhealthy", 503);
    }
  });

  app.get("/metrics", async (c) => {
    const stats = await getQueueStats();
    return c.json(stats);
  });

  app.all("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
    }),
  );

  app.get("/api/events", (c) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (data: string) => {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };
        const heartbeat = setInterval(() => {
          send(JSON.stringify({ type: "heartbeat" }));
        }, 30_000);
        const removeListener = addSSEListener(send);
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          removeListener();
          controller.close();
        });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/webhook/github", async (c) => {
    const rawBody = await readBody(c);
    if (rawBody == null) {
      return c.json({ error: "invalid body" }, 400);
    }

    const sigError = verifyWebhookSignature(c, {
      rawBody,
      headerName: "X-Hub-Signature-256",
      secret: config.webhooks.githubSecret,
      prefix: "sha256=",
      provider: "GitHub",
    });
    if (sigError != null) return sigError;

    const p = parseJsonBody(rawBody);
    if (p == null) {
      return c.json({ error: "invalid JSON" }, 400);
    }

    const event = c.req.header("X-GitHub-Event");
    const deliveryId = c.req.header("X-GitHub-Delivery");
    const action = getString(p, "action");

    if (event === "workflow_run" && action === "completed") {
      const workflowRun = getRecord(p, "workflow_run");
      if (workflowRun == null) {
        return c.json({ error: "missing workflow_run" }, 400);
      }
      const result = await handleWorkflowRun(workflowRun, deliveryId, event);
      return c.json(result, result.error == null ? 200 : 500);
    }

    if (event === "check_suite" && action === "completed") {
      const checkSuite = getRecord(p, "check_suite");
      if (checkSuite == null) {
        return c.json({ error: "missing check_suite" }, 400);
      }
      const result = await handleCheckSuite({
        data: checkSuite,
        payload: p,
        deliveryId,
        event,
      });
      return c.json(result, result.error == null ? 200 : 500);
    }

    return c.json({ status: "ignored", reason: "unhandled event/action" });
  });

  app.post("/webhook/pagerduty", async (c) => {
    const rawBody = await readBody(c);
    if (rawBody == null) return c.json({ error: "invalid body" }, 400);

    const sigError = verifyWebhookSignature(c, {
      rawBody,
      headerName: "X-PagerDuty-Signature",
      secret: config.webhooks.pagerdutySecret,
      prefix: "v1=",
      provider: "PagerDuty",
    });
    if (sigError != null) return sigError;

    const payload = parseJsonBody(rawBody);
    if (payload == null) return c.json({ error: "invalid JSON" }, 400);

    const result = await handlePagerDutyEvent(payload);
    return c.json(result, result.error == null ? 200 : 500);
  });

  app.post("/webhook/bugsink/:token", async (c) => {
    const token = c.req.param("token");
    if (config.webhooks.bugsinkSecret == null) {
      webhookLogger.warn("Bugsink webhook secret not configured");
      return c.json({ error: "webhook not configured" }, 500);
    }

    if (!verifyTokenEqual(token, config.webhooks.bugsinkSecret)) {
      webhookLogger.warn("Bugsink webhook token verification failed");
      return c.json({ error: "invalid token" }, 401);
    }

    const rawBody = await readBody(c);
    if (rawBody == null) return c.json({ error: "invalid body" }, 400);

    const result = await handleBugsinkEvent(rawBody);
    return c.json(result, result.error == null ? 200 : 500);
  });

  app.post("/webhook/buildkite", async (c) => {
    if (config.webhooks.buildkiteToken == null) {
      webhookLogger.warn("Buildkite webhook token not configured");
      return c.json({ error: "webhook not configured" }, 500);
    }

    const buildkiteToken = c.req.header("X-Buildkite-Token");
    if (
      buildkiteToken == null ||
      !verifyTokenEqual(buildkiteToken, config.webhooks.buildkiteToken)
    ) {
      webhookLogger.warn("Buildkite webhook token verification failed");
      return c.json({ error: "invalid token" }, 401);
    }

    const rawBody = await readBody(c);
    if (rawBody == null) return c.json({ error: "invalid body" }, 400);

    const p = parseJsonBody(rawBody);
    if (p == null) return c.json({ error: "invalid JSON" }, 400);

    const result = await handleBuildkiteBuild(
      p,
      c.req.header("X-Buildkite-Event"),
    );
    return c.json(result, result.error == null ? 200 : 500);
  });

  // Static file serving for web UI (production build)
  app.use("/*", serveStatic({ root: "./dist/web" }));
  // SPA fallback: serve index.html for unmatched routes
  app.get("/*", serveStatic({ root: "./dist/web", path: "index.html" }));

  return app;
}

export function startWebhookServer(config: Config): void {
  const app = createApp(config);

  server = Bun.serve({
    fetch: app.fetch,
    port: config.webhooks.port,
    hostname: config.webhooks.host,
  });

  webhookLogger.info(
    { port: config.webhooks.port, host: config.webhooks.host },
    "Webhook server started",
  );
}

export function stopWebhookServer(): void {
  if (server != null) {
    void server.stop(true);
    server = null;
    webhookLogger.info("Webhook server stopped");
  }
}
