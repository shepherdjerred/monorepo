import { Hono, type Context } from "hono";
import { verify } from "@octokit/webhooks-methods";
import * as Sentry from "@sentry/bun";
import type { Client } from "@temporalio/client";
import { PrAgentInputSchema, type PrAgentInput } from "#shared/schemas.ts";
import {
  handleClosedPr,
  startCancelBuildkiteBuilds,
  type CancelStartFn,
} from "./pr-closed.ts";
import { COMPONENT, jsonLog } from "./webhook-log.ts";
import { postWebhookStatus } from "./pr-draft-skipped-status.ts";
import { startPrWorkflows } from "./pr-pipeline-starts.ts";
import {
  prWebhookReceivedTotal,
  prWebhookSignatureFailuresTotal,
  prWebhookSkippedTotal,
} from "#observability/metrics.ts";
import {
  CONFLICT_CHECK_ACTIONS,
  PullRequestEventSchema,
  PushEventSchema,
  RELEVANT_ACTIONS,
  disallowedAuthorReason,
} from "./github-webhook-schema.ts";
import {
  captureConflictCheckStartError,
  startCheckPrMergeConflictsForMain,
  startCheckPrMergeConflictsForPr,
} from "./conflict-check-starts.ts";

const DEFAULT_PORT = 9466;

export type WebhookHandle = {
  port: number;
  close: () => Promise<void>;
};

type StartFn = (input: PrAgentInput) => Promise<void>;
type StatusFn = (input: PrAgentInput, state: "draft_skipped") => Promise<void>;
export type ConflictCheckMainStartFn = (args: {
  owner: string;
  repo: string;
  mainSha: string;
}) => Promise<void>;
export type ConflictCheckPrStartFn = (args: {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
}) => Promise<void>;
const noopCancel: CancelStartFn = () => Promise.resolve();
const noopConflictMain: ConflictCheckMainStartFn = () => Promise.resolve();
const noopConflictPr: ConflictCheckPrStartFn = () => Promise.resolve();

// Master kill switch for the PR bot (review + summary). Defaults enabled; set
// PR_BOT_ENABLED=false to make the webhook ack deliveries (200) without posting
// any comment or starting any workflow. Read at request time so the flag can be
// toggled via env without a code change. See the temporal worker deployment in
// packages/homelab/src/cdk8s/src/resources/temporal/worker.ts.
function isPrBotEnabled(): boolean {
  return (Bun.env["PR_BOT_ENABLED"] ?? "true").toLowerCase() === "true";
}

type DraftSkipContext = {
  deliveryId: string;
  action: string;
};

async function handleDraftSkip(
  c: Context,
  baseInput: PrAgentInput,
  postStatus: StatusFn,
  ctx: DraftSkipContext,
): Promise<Response> {
  const { deliveryId, action } = ctx;
  prWebhookSkippedTotal.inc({ reason: "draft" });
  jsonLog("info", "Skipping draft PR", {
    prNumber: baseInput.prNumber,
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

type PushHandlerArgs = {
  c: Context;
  secret: string;
  payload: string;
  signature: string;
  deliveryId: string;
  startConflictCheckMain: ConflictCheckMainStartFn;
};

async function handlePushEvent(args: PushHandlerArgs): Promise<Response> {
  const { c, secret, payload, signature, deliveryId, startConflictCheckMain } =
    args;
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
    parsed = PushEventSchema.parse(JSON.parse(payload));
  } catch (error: unknown) {
    prWebhookSkippedTotal.inc({ reason: "schema-parse-failed" });
    jsonLog("warning", "Failed to parse push payload", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.text("bad payload\n", 400);
  }

  prWebhookReceivedTotal.inc({ event: "push", action: "push" });

  if (parsed.ref !== "refs/heads/main") {
    prWebhookSkippedTotal.inc({ reason: "push:non-main-ref" });
    jsonLog("info", "Ignoring push to non-main ref", {
      deliveryId,
      ref: parsed.ref,
    });
    return c.text("ignored: non-main ref\n");
  }

  try {
    await startConflictCheckMain({
      owner: parsed.repository.owner.login,
      repo: parsed.repository.name,
      mainSha: parsed.after,
    });
  } catch (error: unknown) {
    captureConflictCheckStartError(error, {
      deliveryId,
      trigger: "push-to-main",
      owner: parsed.repository.owner.login,
      repo: parsed.repository.name,
      mainSha: parsed.after,
    });
    return c.text("conflict-check start failed\n", 500);
  }

  jsonLog("info", "Started merge-conflict check from push to main", {
    deliveryId,
    mainSha: parsed.after,
  });
  return c.text("started\n");
}

/**
 * Optional hooks supplied to `buildWebhookApp` — bundled so the test-time
 * call sites stay legible and the function signature stays under the params
 * cap. Production wires every hook; tests opt in to the ones they need.
 */
export type WebhookHooks = {
  postStatus?: StatusFn;
  startCancel?: CancelStartFn;
  startConflictCheckMain?: ConflictCheckMainStartFn;
  startConflictCheckPr?: ConflictCheckPrStartFn;
};

/**
 * Pure handler — kept separate from Bun.serve so tests can drive it
 * directly without binding a real port.
 */
export function buildWebhookApp(
  secret: string,
  startWorkflows: StartFn,
  hooks: WebhookHooks = {},
): Hono {
  const postStatus = hooks.postStatus ?? postWebhookStatus;
  const startCancel = hooks.startCancel ?? noopCancel;
  const startConflictCheckMain =
    hooks.startConflictCheckMain ?? noopConflictMain;
  const startConflictCheckPr = hooks.startConflictCheckPr ?? noopConflictPr;
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

    if (event === "push") {
      return handlePushEvent({
        c,
        secret,
        payload,
        signature,
        deliveryId,
        startConflictCheckMain,
      });
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

    // Merge-conflict check — runs on opened/synchronize/reopened/edited
    // regardless of draft state, author, or PR_BOT_ENABLED. The kill
    // switch lives on the activity itself (MERGE_CONFLICT_CHECK_ENABLED).
    // Failure here logs to Sentry but does NOT poison the review/summary
    // pipeline below.
    if (CONFLICT_CHECK_ACTIONS.has(action)) {
      try {
        await startConflictCheckPr({
          owner: parsed.repository.owner.login,
          repo: parsed.repository.name,
          prNumber: parsed.pull_request.number,
          headSha: parsed.pull_request.head.sha,
          baseRef: parsed.pull_request.base.ref,
        });
      } catch (error: unknown) {
        captureConflictCheckStartError(error, {
          deliveryId,
          trigger: "pull_request",
          action,
          owner: parsed.repository.owner.login,
          repo: parsed.repository.name,
          prNumber: parsed.pull_request.number,
        });
      }
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

    if (!isPrBotEnabled()) {
      prWebhookSkippedTotal.inc({ reason: "pr-bot-disabled" });
      jsonLog("info", "PR bot disabled; skipping status + workflows", {
        prNumber: baseInput.prNumber,
        action,
      });
      return c.text("skipped: pr-bot disabled\n");
    }

    if (parsed.pull_request.draft === true && action !== "ready_for_review") {
      return handleDraftSkip(c, baseInput, postStatus, { deliveryId, action });
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
    {
      postStatus: postWebhookStatus,
      startCancel: (input) => startCancelBuildkiteBuilds(client, input),
      startConflictCheckMain: (args) =>
        startCheckPrMergeConflictsForMain(client, args),
      startConflictCheckPr: (args) =>
        startCheckPrMergeConflictsForPr(client, args),
    },
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
