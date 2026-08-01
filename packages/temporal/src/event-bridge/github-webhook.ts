import { Hono, type Context } from "hono";
import { verify } from "@octokit/webhooks-methods";
import type { Client } from "@temporalio/client";
import {
  handleClosedPr,
  startCancelBuildkiteBuilds,
  type CancelStartFn,
} from "./pr-closed.ts";
import { jsonLog } from "./webhook-log.ts";
import {
  prWebhookReceivedTotal,
  prWebhookSignatureFailuresTotal,
  prWebhookSkippedTotal,
} from "#observability/metrics.ts";
import {
  CONFLICT_CHECK_ACTIONS,
  PullRequestEventSchema,
  PushEventSchema,
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

/**
 * Verify the `X-Hub-Signature-256` HMAC. Returns a `Response` to return on
 * failure, or `null` when the signature is valid. Extracted from the handler
 * to keep its cyclomatic complexity within bounds.
 */
export async function verifyWebhookSignature(
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
    // Use a push-namespaced reason so dashboards can tell push vs pull_request
    // parse failures apart — same convention as `push:non-main-ref` below.
    prWebhookSkippedTotal.inc({ reason: "push:schema-parse-failed" });
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
 * Merge-conflict check — runs on opened/synchronize/reopened/edited. Failure
 * logs to Sentry but does NOT fail the webhook delivery.
 */
async function maybeStartConflictCheckPr(
  startConflictCheckPr: ConflictCheckPrStartFn,
  args: {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
    baseRef: string;
    action: string;
    deliveryId: string;
  },
): Promise<void> {
  if (!CONFLICT_CHECK_ACTIONS.has(args.action)) {
    return;
  }
  try {
    await startConflictCheckPr({
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
      headSha: args.headSha,
      baseRef: args.baseRef,
    });
  } catch (error: unknown) {
    captureConflictCheckStartError(error, {
      deliveryId: args.deliveryId,
      trigger: "pull_request",
      action: args.action,
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
    });
  }
}

/**
 * Optional hooks supplied to `buildWebhookApp` — bundled so the test-time
 * call sites stay legible and the function signature stays under the params
 * cap. Production wires every hook; tests opt in to the ones they need.
 */
export type WebhookHooks = {
  startCancel?: CancelStartFn;
  startConflictCheckMain?: ConflictCheckMainStartFn;
  startConflictCheckPr?: ConflictCheckPrStartFn;
};

/**
 * Pure handler — kept separate from Bun.serve so tests can drive it
 * directly without binding a real port.
 *
 * Scope: the GitHub webhook server is the ingress for the merge-conflict
 * check (`push` to main + per-PR `pull_request` actions) and for cancelling
 * still-running Buildkite builds when a PR is `closed`. It no longer starts
 * any PR review/summary/babysit workflow.
 */
export function buildWebhookApp(
  secret: string,
  hooks: WebhookHooks = {},
): Hono {
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
    // or bot PRs (Renovate branches churn the most CI).
    if (action === "closed") {
      return handleClosedPr(parsed, deliveryId, startCancel);
    }

    // Per-PR merge-conflict check on opened/synchronize/reopened/edited. A
    // no-op for other actions (see CONFLICT_CHECK_ACTIONS).
    await maybeStartConflictCheckPr(startConflictCheckPr, {
      owner: parsed.repository.owner.login,
      repo: parsed.repository.name,
      prNumber: parsed.pull_request.number,
      headSha: parsed.pull_request.head.sha,
      baseRef: parsed.pull_request.base.ref,
      action,
      deliveryId,
    });

    return c.text("ok\n");
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

  const app = buildWebhookApp(secret, {
    startCancel: (input) => startCancelBuildkiteBuilds(client, input),
    startConflictCheckMain: (args) =>
      startCheckPrMergeConflictsForMain(client, args),
    startConflictCheckPr: (args) =>
      startCheckPrMergeConflictsForPr(client, args),
  });

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
