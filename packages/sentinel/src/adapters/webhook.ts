import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Context } from "hono";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Config } from "@shepherdjerred/sentinel/config/schema.ts";
import { enqueueJob, getQueueStats } from "@shepherdjerred/sentinel/queue/index.ts";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { appRouter } from "@shepherdjerred/sentinel/trpc/router/index.ts";
import { createContext } from "@shepherdjerred/sentinel/trpc/context.ts";
import { addSSEListener } from "@shepherdjerred/sentinel/sse/index.ts";

const webhookLogger = logger.child({ module: "webhook" });

let server: ReturnType<typeof Bun.serve> | null = null;

const RecordSchema = z.record(z.string(), z.unknown());

function verifySignature(payload: string, signature: string, secret: string, prefix: string): boolean {
  const expected = `${prefix}${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function getRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const result = RecordSchema.safeParse(obj[key]);
  return result.success ? result.data : undefined;
}

function extractNestedString(obj: Record<string, unknown>, key: string, nestedKey: string): string | undefined {
  const nested = getRecord(obj, key);
  return nested == null ? undefined : getString(nested, nestedKey);
}

function sanitizeForPrompt(value: string): string {
  return value.replaceAll(/[\n\r]/g, " ").slice(0, 500);
}

function buildPromptBlock(header: string, fields: Record<string, string>): string {
  const lines = [header, "", "--- BEGIN WEBHOOK DATA ---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${sanitizeForPrompt(value)}`);
  }
  lines.push("--- END WEBHOOK DATA ---");
  return lines.join("\n");
}

function parseJsonBody(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = RecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

async function readBody(c: Context): Promise<string | null> {
  const contentLength = c.req.header("Content-Length");
  if (contentLength != null && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return null;
  }
  try {
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) return null;
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

type SigVerifyOptions = {
  rawBody: string;
  headerName: string;
  secret: string | undefined;
  prefix: string;
  provider: string;
};

function verifyMultiSignature(payload: string, header: string, secret: string, prefix: string): boolean {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const expected = `${prefix}${hmac.digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  return header.split(",").some((sig) => {
    const trimmed = sig.trim();
    if (trimmed.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(trimmed), expectedBuf);
  });
}

function verifyWebhookSignature(c: Context, options: SigVerifyOptions): Response | null {
  if (options.secret == null) {
    webhookLogger.warn(`${options.provider} webhook secret not configured`);
    return c.json({ error: "webhook not configured" }, 500);
  }
  const sig = c.req.header(options.headerName);
  if (sig == null) {
    webhookLogger.warn(`${options.provider} webhook signature missing`);
    return c.json({ error: "invalid signature" }, 401);
  }
  const valid = sig.includes(",")
    ? verifyMultiSignature(options.rawBody, sig, options.secret, options.prefix)
    : verifySignature(options.rawBody, sig, options.secret, options.prefix);
  if (!valid) {
    webhookLogger.warn(`${options.provider} webhook signature verification failed`);
    return c.json({ error: "invalid signature" }, 401);
  }
  return null;
}

type WebhookResult = { status: string; jobId?: string; reason?: string; error?: string };

async function handleWorkflowRun(
  workflowRun: Record<string, unknown>,
  deliveryId: string | undefined,
  event: string | undefined,
): Promise<WebhookResult> {
  const conclusion = getString(workflowRun, "conclusion");
  if (conclusion !== "failure") {
    return { status: "ignored", reason: "not a failure" };
  }

  const repo = extractNestedString(workflowRun, "repository", "full_name") ?? "unknown";
  const branch = getString(workflowRun, "head_branch") ?? "unknown";
  const workflowName = getString(workflowRun, "name") ?? "unknown";
  const failureUrl = getString(workflowRun, "html_url") ?? "unknown";

  const prompt = buildPromptBlock("A GitHub CI workflow has failed. Investigate the failure and propose a fix.", {
    Repository: repo, Branch: branch, Workflow: workflowName, Event: "workflow_run", "Failure URL": failureUrl,
  });
  try {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt,
      triggerType: "webhook",
      triggerSource: "github",
      ...(deliveryId == null ? {} : { deduplicationKey: `github:${deliveryId}` }),
      triggerMetadata: { event, deliveryId, repo, branch, workflowName },
    });
    webhookLogger.info({ jobId: job.id, repo, workflowName }, "GitHub workflow_run failure enqueued");
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue GitHub workflow_run job");
    return { status: "error", error: "enqueue failed" };
  }
}

type GitHubEventOptions = {
  data: Record<string, unknown>;
  payload: Record<string, unknown>;
  deliveryId: string | undefined;
  event: string | undefined;
};

function verifyTokenEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handleBuildkiteBuild(
  payload: Record<string, unknown>,
  event: string | undefined,
): Promise<WebhookResult> {
  if (event !== "build.finished") {
    return { status: "ignored", reason: "unhandled event" };
  }

  const build = getRecord(payload, "build");
  if (build == null) return { status: "error", error: "missing build" };

  if (getString(build, "state") !== "failed") {
    return { status: "ignored", reason: "not a failure" };
  }

  const branch = getString(build, "branch") ?? "unknown";
  if (branch !== "main") {
    return { status: "ignored", reason: "not main branch" };
  }

  const pipeline = getRecord(payload, "pipeline");
  const pipelineName = (pipeline == null ? undefined : getString(pipeline, "name")) ?? "unknown";
  const buildUrl = getString(build, "web_url") ?? "unknown";
  const buildId = getString(build, "id") ?? "unknown";
  const message = getString(build, "message") ?? "unknown";

  const prompt = buildPromptBlock("A Buildkite CI build has failed on main. Investigate the failure and propose a fix.", {
    Pipeline: pipelineName, Branch: branch, "Build URL": buildUrl, "Commit message": message,
  });
  try {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt,
      triggerType: "webhook",
      triggerSource: "buildkite",
      deduplicationKey: `buildkite:${buildId}`,
      triggerMetadata: { event, pipelineName, branch, buildUrl, buildId },
    });
    webhookLogger.info(
      { jobId: job.id, pipelineName, buildUrl },
      "Buildkite build failure enqueued",
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue Buildkite job");
    return { status: "error", error: "enqueue failed" };
  }
}

async function handleCheckSuite(options: GitHubEventOptions): Promise<WebhookResult> {
  const conclusion = getString(options.data, "conclusion");
  if (conclusion !== "failure") {
    return { status: "ignored", reason: "not a failure" };
  }

  const repo = extractNestedString(options.payload, "repository", "full_name") ?? "unknown";
  const branch = getString(options.data, "head_branch") ?? "unknown";
  const failureUrl = getString(options.data, "url") ?? "unknown";

  const prompt = buildPromptBlock("A GitHub CI workflow has failed. Investigate the failure and propose a fix.", {
    Repository: repo, Branch: branch, Workflow: "check_suite", Event: "check_suite", "Failure URL": failureUrl,
  });
  try {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt,
      triggerType: "webhook",
      triggerSource: "github",
      ...(options.deliveryId == null ? {} : { deduplicationKey: `github:${options.deliveryId}` }),
      triggerMetadata: { event: options.event, deliveryId: options.deliveryId, repo, branch },
    });
    webhookLogger.info({ jobId: job.id, repo }, "GitHub check_suite failure enqueued");
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue GitHub check_suite job");
    return { status: "error", error: "enqueue failed" };
  }
}

async function handlePagerDutyEvent(
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  const event = getRecord(payload, "event");
  if (event == null) return { status: "error", error: "missing event" };

  const eventType = getString(event, "event_type");
  if (eventType !== "incident.triggered") {
    return { status: "ignored", reason: "unhandled event type" };
  }

  const eventId = getString(event, "id");
  const eventData = getRecord(event, "data");
  const title = (eventData == null ? undefined : getString(eventData, "title")) ?? "unknown";
  const urgency = (eventData == null ? undefined : getString(eventData, "urgency")) ?? "unknown";
  const htmlUrl = (eventData == null ? undefined : getString(eventData, "html_url")) ?? "unknown";
  const service = eventData == null ? undefined : extractNestedString(eventData, "service", "summary");

  const prompt = buildPromptBlock("A PagerDuty incident has been triggered. Investigate and triage this alert.", {
    Title: title, Service: service ?? "unknown", Urgency: urgency, URL: htmlUrl,
  });

  try {
    const job = await enqueueJob({
      agent: "pd-triager",
      prompt,
      triggerType: "webhook",
      triggerSource: "pagerduty",
      ...(eventId == null ? {} : { deduplicationKey: `pagerduty:${eventId}` }),
      triggerMetadata: { eventType, eventId, title, service, urgency },
    });
    webhookLogger.info({ jobId: job.id, title, service }, "PagerDuty incident enqueued");
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue PagerDuty job");
    return { status: "error", error: "enqueue failed" };
  }
}

async function handleBugsinkEvent(rawBody: string): Promise<WebhookResult> {
  const p = parseJsonBody(rawBody);
  if (p == null) return { status: "error", error: "invalid JSON" };

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const title = getString(p, "title") ?? "unknown error";
  const project = getString(p, "project") ?? "unknown";
  const url = getString(p, "url") ?? "unknown";

  const prompt = buildPromptBlock("A new error has been reported in Bugsink. Investigate and triage this error.", {
    Title: title, Project: project, URL: url,
  });
  try {
    const job = await enqueueJob({
      agent: "personal-assistant",
      prompt,
      triggerType: "webhook",
      triggerSource: "bugsink",
      deduplicationKey: `bugsink:${bodyHash}`,
      triggerMetadata: { title, project, url },
    });
    webhookLogger.info({ jobId: job.id, title, project }, "Bugsink error enqueued");
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue Bugsink job");
    return { status: "error", error: "enqueue failed" };
  }
}

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
    fetchRequestHandler({ endpoint: "/trpc", req: c.req.raw, router: appRouter, createContext }),
  );

  app.get("/api/events", (c) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (data: string) => { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); };
        const heartbeat = setInterval(() => { send(JSON.stringify({ type: "heartbeat" })); }, 30_000);
        const removeListener = addSSEListener(send);
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          removeListener();
          controller.close();
        });
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
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
      const result = await handleCheckSuite({ data: checkSuite, payload: p, deliveryId, event });
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
    if (buildkiteToken == null || !verifyTokenEqual(buildkiteToken, config.webhooks.buildkiteToken)) {
      webhookLogger.warn("Buildkite webhook token verification failed");
      return c.json({ error: "invalid token" }, 401);
    }

    const rawBody = await readBody(c);
    if (rawBody == null) return c.json({ error: "invalid body" }, 400);

    const p = parseJsonBody(rawBody);
    if (p == null) return c.json({ error: "invalid JSON" }, 400);

    const result = await handleBuildkiteBuild(p, c.req.header("X-Buildkite-Event"));
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
