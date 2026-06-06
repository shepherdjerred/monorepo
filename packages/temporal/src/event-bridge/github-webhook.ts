import { Hono } from "hono";
import { verify } from "@octokit/webhooks-methods";
import { Octokit } from "octokit";
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
  type PrSummaryInput,
} from "#shared/schemas.ts";
import {
  handleClosedPr,
  startCancelBuildkiteBuilds,
  type CancelStartFn,
} from "./pr-closed.ts";
import {
  prWebhookReceivedTotal,
  prWebhookSignatureFailuresTotal,
  prWebhookSkippedTotal,
} from "#observability/metrics.ts";
import {
  DRY_RUN_COMMENT_ID,
  isPostEnabled,
  runPostReviewStatus,
} from "#activities/pr-review/post.ts";
import { STATUS_COMMENT_MARKER } from "#activities/pr-review/post-render.ts";
import {
  renderStatusCommentBody,
  type PostReviewStatusInput,
} from "#activities/pr-review/post-status-render.ts";
import {
  type PostReviewOctokit,
  type PostReviewStatusResult,
} from "#activities/pr-review/post-github.ts";
import {
  createGitHubAppInstallationToken,
  type GitHubAppTokenResult,
} from "#lib/github-app-token.ts";

const COMPONENT = "pr-webhook";
const DEFAULT_PORT = 9466;

const RELEVANT_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review",
]);

// Security: PR automation (the review/summary pipelines — whose verify stage
// checks out and executes PR-head code) must only run for the trusted
// repository owner. The repo is public, so without this gate any external
// fork PR's title/diff/code would flow into the agents and the verifier.
const ALLOWED_PR_AUTHOR = "shepherdjerred";

// Returns a skip reason (for metrics/logs) when a PR's author is not the
// trusted owner — bots and any non-owner account are skipped — or null to
// proceed.
function disallowedAuthorReason(user: {
  readonly login: string;
  readonly type: string;
}): string | null {
  if (user.type === "Bot") return "bot-author";
  if (user.login !== ALLOWED_PR_AUTHOR) return "untrusted-author";
  return null;
}

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
  merged: z.boolean().optional(),
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

function pipelineWorkflowIdFor(pr: PrReviewPipelineInput): string {
  return `pr-review-pipeline-${pr.owner}-${pr.repo}-${String(pr.prNumber)}-${pr.commitSha}`;
}

function summaryPipelineWorkflowIdFor(pr: PrSummaryInput): string {
  return `pr-summary-pipeline-${pr.owner}-${pr.repo}-${String(pr.prNumber)}-${pr.commitSha}`;
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

async function startPrSummaryPipeline(
  client: Client,
  summaryInput: PrSummaryInput,
): Promise<void> {
  // Same idempotency model as the review pipeline — redelivered webhooks
  // for the same commit sha no-op at the server.
  try {
    await client.workflow.start("prSummaryPipeline", {
      taskQueue: TASK_QUEUES.PR_SUMMARY,
      workflowId: summaryPipelineWorkflowIdFor(summaryInput),
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [summaryInput],
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      jsonLog("info", "pr-summary pipeline already started for this commit", {
        prNumber: summaryInput.prNumber,
        commitSha: summaryInput.commitSha,
        workflowId: summaryPipelineWorkflowIdFor(summaryInput),
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

  const summaryInput: PrSummaryInput = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    commitSha: input.commitSha,
    baseRef: input.baseRef,
    headRef: input.headRef,
    prTitle: input.prTitle,
    prAuthor: input.prAuthor,
  };

  // SOTA review pipeline (multi-specialist consensus + verification) +
  // summary pipeline (Haiku 4.5 + prompt caching) are now the sole path.
  // The legacy `prReview` + `prSummary` claude -p workflows were retired
  // in the cutover commit — see
  // packages/docs/plans/2026-05-10_sota-pr-review-bot.md addendum.
  await Promise.all([
    startPrReviewPipeline(client, pipelineInput),
    startPrSummaryPipeline(client, summaryInput),
  ]);
}

type StartFn = (input: PrAgentInput) => Promise<void>;
type StatusFn = (input: PrAgentInput, state: "draft_skipped") => Promise<void>;
const noopCancel: CancelStartFn = () => Promise.resolve();
type WebhookStatusDeps = {
  createInstallationToken?: () => Promise<GitHubAppTokenResult>;
  createOctokit?: (token: string) => PostReviewOctokit;
};

function toPipelineInput(input: PrAgentInput): PrReviewPipelineInput {
  return {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    commitSha: input.commitSha,
    baseRef: input.baseRef,
    headRef: input.headRef,
    prTitle: input.prTitle,
    prAuthor: input.prAuthor,
  };
}

export async function postWebhookStatus(
  input: PrAgentInput,
  state: "draft_skipped",
  deps: WebhookStatusDeps = {},
): Promise<void> {
  const statusInput: PostReviewStatusInput = {
    pipeline: toPipelineInput(input),
    state,
    workflowId: `pr-review-webhook-${input.owner}-${input.repo}-${String(input.prNumber)}-${input.commitSha}`,
  };

  if (!isPostEnabled(Bun.env["PR_REVIEW_POST_ENABLED"])) {
    const body = renderStatusCommentBody(statusInput, STATUS_COMMENT_MARKER);
    jsonLog("info", "PR review webhook status suppressed", {
      prNumber: input.prNumber,
      state,
      syntheticCommentId: DRY_RUN_COMMENT_ID,
      bodyBytes: body.length,
    });
    return;
  }

  const tokenResult = await (
    deps.createInstallationToken ?? createGitHubAppInstallationToken
  )();
  const octokit =
    deps.createOctokit?.(tokenResult.token) ??
    new Octokit({ auth: tokenResult.token });
  const result: PostReviewStatusResult = await runPostReviewStatus(
    octokit,
    statusInput,
    (error, extra) => {
      Sentry.withScope((scope) => {
        scope.setTag("component", COMPONENT);
        scope.setContext("webhookStatus", {
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          state,
          ...extra,
        });
        Sentry.captureException(error);
      });
    },
  );
  jsonLog("info", "Posted PR review webhook status", {
    prNumber: input.prNumber,
    state,
    commentId: result.commentId,
    created: result.created,
  });
}

/**
 * Verify the `X-Hub-Signature-256` HMAC. Returns a `Response` to return on
 * failure, or `null` when the signature is valid. Extracted from the handler
 * to keep its cyclomatic complexity within bounds.
 */
async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
  deliveryId: string,
): Promise<Response | null> {
  if (signature.length === 0) {
    prWebhookSignatureFailuresTotal.inc();
    jsonLog("warning", "Missing X-Hub-Signature-256", { deliveryId });
    return new Response("missing signature\n", { status: 401 });
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
    return new Response("bad signature\n", { status: 401 });
  }

  if (!signatureOk) {
    prWebhookSignatureFailuresTotal.inc();
    jsonLog("warning", "Bad X-Hub-Signature-256", { deliveryId });
    return new Response("bad signature\n", { status: 401 });
  }

  return null;
}

/**
 * Pure handler — kept separate from Bun.serve so tests can drive it
 * directly without binding a real port.
 */
export function buildWebhookApp(
  secret: string,
  startWorkflows: StartFn,
  postStatus: StatusFn = postWebhookStatus,
  startCancel: CancelStartFn = noopCancel,
): Hono {
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

    const sigFailure = await verifyWebhookSignature(
      secret,
      payload,
      signature,
      deliveryId,
    );
    if (sigFailure !== null) {
      return sigFailure;
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

    // PR closed (merged or plain close): stop any still-active Buildkite builds
    // for the head branch. Delegated to handleClosedPr — it does not skip draft
    // or bot PRs (Renovate branches churn the most CI). Runs before the
    // review/summary RELEVANT_ACTIONS gate.
    if (action === "closed") {
      return handleClosedPr(parsed, deliveryId, startCancel);
    }

    if (!RELEVANT_ACTIONS.has(action)) {
      prWebhookSkippedTotal.inc({ reason: `action:${action}` });
      jsonLog("info", "Ignoring action", {
        action,
        prNumber: parsed.pull_request.number,
      });
      return c.text("ignored\n");
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

    if (parsed.pull_request.draft === true && action !== "ready_for_review") {
      prWebhookSkippedTotal.inc({ reason: "draft" });
      jsonLog("info", "Skipping draft PR", {
        prNumber: parsed.pull_request.number,
        action,
      });
      try {
        await postStatus(baseInput, "draft_skipped");
      } catch (error: unknown) {
        Sentry.withScope((scope) => {
          scope.setTag("component", COMPONENT);
          scope.setContext("webhook", {
            deliveryId,
            action,
            owner: baseInput.owner,
            repo: baseInput.repo,
            prNumber: baseInput.prNumber,
            skipReason: "draft",
          });
          Sentry.captureException(error);
        });
        jsonLog("error", "Failed to post draft skipped status", {
          deliveryId,
          action,
          prNumber: baseInput.prNumber,
          error: error instanceof Error ? error.message : String(error),
        });
        return c.text("draft status failed\n", 500);
      }
      return c.text("skipped: draft\n");
    }

    const authorSkip = disallowedAuthorReason(parsed.pull_request.user);
    if (authorSkip !== null) {
      prWebhookSkippedTotal.inc({ reason: authorSkip });
      jsonLog("info", "Skipping PR by author policy", {
        prNumber: parsed.pull_request.number,
        author: parsed.pull_request.user.login,
        reason: authorSkip,
      });
      return c.text(`skipped: ${authorSkip}\n`);
    }

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

  const app = buildWebhookApp(
    secret,
    (input) => startPrWorkflows(client, input),
    postWebhookStatus,
    (input) => startCancelBuildkiteBuilds(client, input),
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
