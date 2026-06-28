/**
 * GitHub `issue_comment` ingress for the PR babysitter. Kept out of
 * `github-webhook.ts` (which is at its line budget). Verifies the signature,
 * then gates: only `created` comments, only on PRs, never the bot's own
 * comments, only owner-authorized authors. A recognized `@<handle>` command
 * routes to Temporal; an authorized plain reply routes as potential guidance.
 * The kill switch (`PR_BABYSIT_ENABLED`, default off) acks deliveries without
 * acting, so the feature lands dormant.
 */
import { type Context } from "hono";
import {
  prBabysitCommandsTotal,
  prWebhookReceivedTotal,
  prWebhookSkippedTotal,
} from "#observability/metrics.ts";
import {
  IssueCommentEventSchema,
  babysitCommandAuthz,
} from "./github-webhook-schema.ts";
import { parseBabysitCommand } from "./babysit-command.ts";
import type { BabysitRouteFn } from "./babysit-starts.ts";
import { verifyWebhookSignature } from "./github-webhook.ts";
import { jsonLog } from "./webhook-log.ts";

// Independent master kill switch for the babysitter — default OFF, so the
// feature lands dormant. Read per-request; toggle via env without a code change.
// Deliberately NOT gated behind PR_BOT_ENABLED (which is off from the review-bot
// 429 incident) so the two never entangle.
export function isPrBabysitEnabled(): boolean {
  return (Bun.env["PR_BABYSIT_ENABLED"] ?? "false").toLowerCase() === "true";
}
function babysitBotHandle(): string {
  return Bun.env["PR_BABYSIT_BOT_HANDLE"] ?? "@temporal-worker";
}
function babysitBotLogin(): string {
  return Bun.env["PR_BABYSIT_BOT_LOGIN"] ?? "temporal-worker[bot]";
}

export const noopBabysitRoute: BabysitRouteFn = () => Promise.resolve();

/** True when the comment author is a bot / the babysitter itself (loop guard). */
function isBabysitLoopAuthor(login: string, type: string): boolean {
  return (
    type === "Bot" || login.endsWith("[bot]") || login === babysitBotLogin()
  );
}

export type IssueCommentHandlerArgs = {
  c: Context;
  secret: string;
  payload: string;
  signature: string;
  deliveryId: string;
  babysitRoute: BabysitRouteFn;
};

export async function handleIssueCommentEvent(
  args: IssueCommentHandlerArgs,
): Promise<Response> {
  const { c, secret, payload, signature, deliveryId, babysitRoute } = args;
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
    parsed = IssueCommentEventSchema.parse(JSON.parse(payload));
  } catch (error: unknown) {
    prWebhookSkippedTotal.inc({ reason: "issue_comment:schema-parse-failed" });
    jsonLog("warning", "Failed to parse issue_comment payload", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.text("bad payload\n", 400);
  }

  prWebhookReceivedTotal.inc({ event: "issue_comment", action: parsed.action });

  if (!isPrBabysitEnabled()) {
    prBabysitCommandsTotal.inc({ command: "none", outcome: "disabled" });
    return c.text("skipped: pr-babysit disabled\n");
  }
  if (parsed.action !== "created") {
    prWebhookSkippedTotal.inc({
      reason: `issue_comment:action-${parsed.action}`,
    });
    return c.text("ignored\n");
  }
  if (parsed.issue.pull_request === undefined) {
    prWebhookSkippedTotal.inc({ reason: "issue_comment:not-a-pr" });
    return c.text("ignored\n");
  }
  const { login, type } = parsed.comment.user;
  if (isBabysitLoopAuthor(login, type)) {
    prWebhookSkippedTotal.inc({ reason: "issue_comment:bot-author" });
    return c.text("ignored\n");
  }

  const command = parseBabysitCommand(parsed.comment.body, babysitBotHandle());
  const authzReason = babysitCommandAuthz(parsed.comment);
  if (authzReason !== null) {
    // Unauthorized: silent ignore (no reply/reaction) — no abuse surface on a
    // public repo. Counter + log only.
    prBabysitCommandsTotal.inc({
      command: command.kind,
      outcome: "unauthorized",
    });
    jsonLog("warning", "Ignoring unauthorized babysit comment", {
      deliveryId,
      author: login,
      authorAssociation: parsed.comment.author_association,
      prNumber: parsed.issue.number,
      reason: authzReason,
    });
    return c.text("ignored: unauthorized\n");
  }

  await babysitRoute({
    owner: parsed.repository.owner.login,
    repo: parsed.repository.name,
    prNumber: parsed.issue.number,
    commentId: parsed.comment.id,
    requestedBy: login,
    body: parsed.comment.body,
    command,
  });
  return c.text("ok\n");
}
