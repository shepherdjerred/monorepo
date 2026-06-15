import { Octokit } from "octokit";
import * as Sentry from "@sentry/bun";
import type { PrAgentInput, PrReviewPipelineInput } from "#shared/schemas.ts";
import { COMPONENT, jsonLog } from "./webhook-log.ts";
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

/**
 * Injected dependencies for `postWebhookStatus` — tests stub both the token
 * minting and the Octokit client to avoid hitting github.com.
 */
export type WebhookStatusDeps = {
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

/**
 * Post a visible "draft skipped" comment on a PR so the author knows the
 * review bot intentionally took no action. Honours the PR_REVIEW_POST_ENABLED
 * kill switch — when disabled, logs the rendered body without posting.
 */
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
