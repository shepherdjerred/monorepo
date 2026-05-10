import { Hono } from "hono";
import { verify } from "@octokit/webhooks-methods";
import { z } from "zod/v4";
import * as Sentry from "@sentry/bun";
import type { Client } from "@temporalio/client";
import { WorkflowIdReusePolicy } from "@temporalio/common";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  PrAgentInputSchema,
  type PrAgentInput,
  type PrReviewPipelineInput,
} from "#shared/schemas.ts";
import {
  prWebhookReceivedTotal,
  prWebhookSignatureFailuresTotal,
  prWebhookSkippedTotal,
} from "#observability/metrics.ts";

const COMPONENT = "pr-webhook";
const DEFAULT_PORT = 9466;

const RELEVANT_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

const PrUserSchema = z.object({
  login: z.string(),
  type: z.string(),
});

const PrRefSchema = z.object({
  ref: z.string(),
  sha: z.string(),
});

const PrSchema = z.object({
  number: z.number().int().positive(),
  draft: z.boolean().optional(),
  title: z.string(),
  base: PrRefSchema,
  head: PrRefSchema,
  user: PrUserSchema,
});

const RepoOwnerSchema = z.object({ login: z.string() });

const RepoSchema = z.object({
  name: z.string(),
  owner: RepoOwnerSchema,
});

const PullRequestEventSchema = z.object({
  action: z.string(),
  pull_request: PrSchema,
  repository: RepoSchema,
});

export type WebhookHandle = {
  port: number;
  close: () => Promise<void>;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...fields,
    }),
  );
}

function workflowIdFor(kind: PrAgentInput["kind"], pr: PrAgentInput): string {
  return `pr-${kind}-${pr.owner}-${pr.repo}-${String(pr.prNumber)}-${pr.commitSha}`;
}

function pipelineWorkflowIdFor(pr: PrReviewPipelineInput): string {
  return `pr-review-pipeline-${pr.owner}-${pr.repo}-${String(pr.prNumber)}-${pr.commitSha}`;
}

async function startPrReviewPipeline(
  client: Client,
  pipelineInput: PrReviewPipelineInput,
): Promise<void> {
  // REJECT_DUPLICATE so a redelivered webhook for the same commit sha
  // no-ops at the Temporal server rather than re-running the pipeline.
  // The "already-started" error is the expected idempotent path; surface
  // it as an info log rather than a workflow-start failure.
  try {
    await client.workflow.start("prReviewPipeline", {
      taskQueue: TASK_QUEUES.PR_REVIEW,
      workflowId: pipelineWorkflowIdFor(pipelineInput),
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [pipelineInput],
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      jsonLog("info", "pr-review pipeline already started for this commit", {
        prNumber: pipelineInput.prNumber,
        commitSha: pipelineInput.commitSha,
        workflowId: pipelineWorkflowIdFor(pipelineInput),
      });
      return;
    }
    throw error;
  }
}

async function startPrWorkflows(
  client: Client,
  input: PrAgentInput,
): Promise<void> {
  const pipelineInput: PrReviewPipelineInput = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    commitSha: input.commitSha,
    baseRef: input.baseRef,
    headRef: input.headRef,
    prTitle: input.prTitle,
    prAuthor: input.prAuthor,
  };

  await Promise.all([
    client.workflow.start("prReview", {
      taskQueue: TASK_QUEUES.DEFAULT,
      workflowId: workflowIdFor("review", input),
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      args: [{ ...input, kind: "review" }],
    }),
    client.workflow.start("prSummary", {
      taskQueue: TASK_QUEUES.DEFAULT,
      workflowId: workflowIdFor("summary", input),
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      args: [{ ...input, kind: "summary" }],
    }),
    // SOTA pipeline (shadow mode during the multi-phase rollout — see
    // packages/docs/plans/2026-05-10_sota-pr-review-bot.md).
    startPrReviewPipeline(client, pipelineInput),
  ]);
}

type StartFn = (input: PrAgentInput) => Promise<void>;

/**
 * Pure handler — kept separate from Bun.serve so tests can drive it
 * directly without binding a real port.
 */
export function buildWebhookApp(secret: string, startWorkflows: StartFn): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok\n"));

  app.post("/webhook", async (c) => {
    const event = c.req.header("x-github-event") ?? "";
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const deliveryId = c.req.header("x-github-delivery") ?? "";
    const payload = await c.req.text();

    if (event === "ping") {
      jsonLog("info", "Received ping", { deliveryId });
      return c.text("pong\n");
    }

    if (event !== "pull_request") {
      prWebhookSkippedTotal.inc({ reason: "non-pull-request-event" });
      jsonLog("info", "Ignoring non-pull_request event", { event, deliveryId });
      return c.text("ignored\n");
    }

    if (signature.length === 0) {
      prWebhookSignatureFailuresTotal.inc();
      jsonLog("warning", "Missing X-Hub-Signature-256", { deliveryId });
      return c.text("missing signature\n", 401);
    }

    let signatureOk: boolean;
    try {
      signatureOk = await verify(secret, payload, signature);
    } catch (error: unknown) {
      prWebhookSignatureFailuresTotal.inc();
      jsonLog("warning", "Signature verify threw", {
        deliveryId,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.text("bad signature\n", 401);
    }

    if (!signatureOk) {
      prWebhookSignatureFailuresTotal.inc();
      jsonLog("warning", "Bad X-Hub-Signature-256", { deliveryId });
      return c.text("bad signature\n", 401);
    }

    let parsed;
    try {
      parsed = PullRequestEventSchema.parse(JSON.parse(payload));
    } catch (error: unknown) {
      prWebhookSkippedTotal.inc({ reason: "schema-parse-failed" });
      jsonLog("warning", "Failed to parse pull_request payload", {
        deliveryId,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.text("bad payload\n", 400);
    }

    const action = parsed.action;
    prWebhookReceivedTotal.inc({ event: "pull_request", action });

    if (!RELEVANT_ACTIONS.has(action)) {
      prWebhookSkippedTotal.inc({ reason: `action:${action}` });
      jsonLog("info", "Ignoring action", {
        action,
        prNumber: parsed.pull_request.number,
      });
      return c.text("ignored\n");
    }

    if (parsed.pull_request.draft === true && action !== "ready_for_review") {
      prWebhookSkippedTotal.inc({ reason: "draft" });
      jsonLog("info", "Skipping draft PR", {
        prNumber: parsed.pull_request.number,
        action,
      });
      return c.text("skipped: draft\n");
    }

    if (parsed.pull_request.user.type === "Bot") {
      prWebhookSkippedTotal.inc({ reason: "bot-author" });
      jsonLog("info", "Skipping bot-authored PR", {
        prNumber: parsed.pull_request.number,
        author: parsed.pull_request.user.login,
      });
      return c.text("skipped: bot\n");
    }

    const baseInput: PrAgentInput = PrAgentInputSchema.parse({
      kind: "review",
      owner: parsed.repository.owner.login,
      repo: parsed.repository.name,
      prNumber: parsed.pull_request.number,
      commitSha: parsed.pull_request.head.sha,
      baseRef: parsed.pull_request.base.ref,
      headRef: parsed.pull_request.head.ref,
      prTitle: parsed.pull_request.title,
      prAuthor: parsed.pull_request.user.login,
    });

    try {
      await startWorkflows(baseInput);
    } catch (error: unknown) {
      Sentry.withScope((scope) => {
        scope.setTag("component", COMPONENT);
        scope.setContext("webhook", {
          deliveryId,
          action,
          owner: baseInput.owner,
          repo: baseInput.repo,
          prNumber: baseInput.prNumber,
        });
        Sentry.captureException(error);
      });
      jsonLog("error", "Failed to start PR workflows", {
        deliveryId,
        action,
        prNumber: baseInput.prNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.text("workflow start failed\n", 500);
    }

    jsonLog("info", "Started PR workflows", {
      deliveryId,
      action,
      prNumber: baseInput.prNumber,
      commitSha: baseInput.commitSha,
    });
    return c.text("started\n");
  });

  return app;
}

export function startGithubWebhook(client: Client): WebhookHandle {
  const secret = Bun.env["GITHUB_WEBHOOK_SECRET"];
  if (secret === undefined || secret === "") {
    throw new Error("GITHUB_WEBHOOK_SECRET environment variable is required");
  }

  const port = Number.parseInt(
    Bun.env["GITHUB_WEBHOOK_PORT"] ?? String(DEFAULT_PORT),
    10,
  );

  const app = buildWebhookApp(secret, (input) =>
    startPrWorkflows(client, input),
  );

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
  });

  jsonLog("info", "GitHub webhook server started", { port });

  return {
    port,
    async close() {
      await server.stop();
      jsonLog("info", "GitHub webhook server stopped");
    },
  };
}
