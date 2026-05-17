import { Context } from "@temporalio/activity";
import { Octokit, RequestError } from "octokit";
import * as Sentry from "@sentry/bun";
import { withSpan } from "#observability/tracing.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  requiredWorkflowId,
  workflowExecutionContext,
} from "#activities/temporal-context.ts";
import {
  buildInlineReviewComments,
  markerFor,
  renderCommentBody,
  renderStatusCommentBody,
  STATUS_COMMENT_MARKER,
  type PostReviewInput,
  type PostReviewStatusInput,
} from "./post-render.ts";
import {
  postInlineReview,
  upsertStatusComment,
  type PostReviewOctokit,
  type PostReviewStatusResult,
} from "./post-github.ts";

const COMPONENT = "pr-review-pipeline";

export type PostReviewResult = {
  /** Numeric id of the issue comment created or updated. */
  commentId: number;
  /** Whether the activity created a new comment (true) or edited an existing one (false). */
  created: boolean;
  /** Numeric id of the submitted PR review, or null when no inline review was submitted. */
  inlineReviewId: number | null;
  /** Number of inline review comments submitted in this run. */
  inlineCommentsPosted: number;
  /** Number of findings left only in the top-level status because no diff anchor was safe. */
  inlineCommentsSkippedUnanchored: number;
  /** Number of findings skipped because an inline marker already existed for this commit. */
  inlineCommentsSkippedDuplicate: number;
  /** Whether inline review submission failed after payload construction. */
  inlineCommentsFailed: boolean;
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
      activity: "postReview",
      ...fields,
    }),
  );
}

function captureWithContext(
  error: unknown,
  input: PostReviewInput,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    const info = Context.current().info;
    scope.setTag("workflow", info.workflowType);
    scope.setTag("activity", info.activityType);
    scope.setTag("component", COMPONENT);
    scope.setContext("prReviewPostReview", {
      ...workflowExecutionContext(info),
      attempt: info.attempt,
      owner: input.pipeline.owner,
      repo: input.pipeline.repo,
      prNumber: input.pipeline.prNumber,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

function captureStatusWithContext(
  error: unknown,
  input: PostReviewStatusInput,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    const info = Context.current().info;
    scope.setTag("workflow", info.workflowType);
    scope.setTag("activity", info.activityType);
    scope.setTag("component", COMPONENT);
    scope.setContext("prReviewPostStatus", {
      ...workflowExecutionContext(info),
      attempt: info.attempt,
      owner: input.pipeline.owner,
      repo: input.pipeline.repo,
      prNumber: input.pipeline.prNumber,
      state: input.state,
      ...extra,
    });
    Sentry.captureException(error);
  });
}

/**
 * Pure runner — does the actual GitHub calls. Exported so tests can drive
 * it directly with a fake Octokit and workflowId.
 */
export async function runPostReview(
  octokit: PostReviewOctokit,
  input: PostReviewInput,
  workflowId: string,
  onError: (error: unknown, extra: Record<string, unknown>) => void,
): Promise<PostReviewResult> {
  const marker = markerFor(workflowId);

  jsonLog("info", "postReview invoked", {
    prNumber: input.pipeline.prNumber,
    commitSha: input.pipeline.commitSha,
    findingsCount: input.findings.length,
    workflowId,
  });

  try {
    const inline = await postInlineReview({
      octokit,
      review: input,
      onError,
    });
    const body = renderCommentBody(input, marker, inline.summary);
    const status = await upsertStatusComment({
      octokit,
      pipeline: input.pipeline,
      marker,
      body,
    });
    jsonLog("info", "Upserted PR-review status comment", {
      commentId: status.commentId,
      prNumber: input.pipeline.prNumber,
      created: status.created,
      inlineCommentsPosted: inline.summary.posted,
      inlineCommentsSkippedUnanchored: inline.summary.skippedUnanchored,
      inlineCommentsSkippedDuplicate: inline.summary.skippedDuplicate,
      inlineCommentsFailed: inline.summary.failed,
    });
    return {
      commentId: status.commentId,
      created: status.created,
      inlineReviewId: inline.reviewId,
      inlineCommentsPosted: inline.summary.posted,
      inlineCommentsSkippedUnanchored: inline.summary.skippedUnanchored,
      inlineCommentsSkippedDuplicate: inline.summary.skippedDuplicate,
      inlineCommentsFailed: inline.summary.failed,
    };
  } catch (error: unknown) {
    const status = error instanceof RequestError ? error.status : undefined;
    onError(error, { httpStatus: status });
    jsonLog("error", "postReview failed", {
      prNumber: input.pipeline.prNumber,
      httpStatus: status,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runPostReviewStatus(
  octokit: PostReviewOctokit,
  input: PostReviewStatusInput,
  onError: (error: unknown, extra: Record<string, unknown>) => void,
): Promise<PostReviewStatusResult> {
  const marker = STATUS_COMMENT_MARKER;
  const body = renderStatusCommentBody(input, marker);
  try {
    const result = await upsertStatusComment({
      octokit,
      pipeline: input.pipeline,
      marker,
      body,
    });
    jsonLog("info", "Upserted PR-review lifecycle status comment", {
      prNumber: input.pipeline.prNumber,
      commitSha: input.pipeline.commitSha,
      state: input.state,
      created: result.created,
      commentId: result.commentId,
    });
    return result;
  } catch (error: unknown) {
    const status = error instanceof RequestError ? error.status : undefined;
    onError(error, { httpStatus: status, phase: "status-comment" });
    jsonLog("error", "postReview status failed", {
      prNumber: input.pipeline.prNumber,
      state: input.state,
      httpStatus: status,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Sentinel comment ID returned when the post is dry-run-suppressed. Real
 * GitHub comment IDs are positive 64-bit integers, so `-1` is unambiguously
 * synthetic. Downstream activities (`emitMetrics`, `trackForLearning`) treat
 * a negative id as "not posted" — see those files.
 */
export const DRY_RUN_COMMENT_ID = -1;

/**
 * Gate that lets the pipeline run end-to-end (bootstrap → specialists →
 * verify → dedupe → render) without actually posting to the live PR. Defaults
 * to **off** — the pipeline ships dry by default until shadow-mode (Phase 12)
 * is in place. Flip `PR_REVIEW_POST_ENABLED=true` on the temporal-worker
 * Deployment once team-lead has gated rollout (e.g. specific repos, specific
 * accounts) appropriately. See packages/docs/plans/2026-05-10_sota-pr-review-bot.md.
 *
 * Exported as a thin wrapper so tests can drive it with any env-like map.
 */
export function isPostEnabled(envValue: string | undefined): boolean {
  return (envValue ?? "").toLowerCase() === "true";
}

function isPostEnabledFromEnv(): boolean {
  return isPostEnabled(Bun.env["PR_REVIEW_POST_ENABLED"]);
}

async function postReviewImpl(
  input: PostReviewInput,
): Promise<PostReviewResult> {
  return await withSpan(
    "prReview.postReview",
    {
      "pr.owner": input.pipeline.owner,
      "pr.repo": input.pipeline.repo,
      "pr.number": input.pipeline.prNumber,
      "findings.count": input.findings.length,
    },
    async () => {
      const workflowId = requiredWorkflowId(Context.current().info);

      if (!isPostEnabledFromEnv()) {
        // Dry-run: render the body for the log so operators can see what
        // *would* have been posted, but skip GitHub mutations entirely.
        // The synthetic id signals downstream activities to skip their
        // post-dependent work.
        const marker = markerFor(workflowId);
        const inline = buildInlineReviewComments({
          pipeline: input.pipeline,
          findings: input.findings,
          changedFiles: input.changedFiles,
          existingMarkers: new Set<string>(),
        });
        const body = renderCommentBody(input, marker, inline.summary);
        jsonLog(
          "info",
          "postReview suppressed (PR_REVIEW_POST_ENABLED!=true)",
          {
            prNumber: input.pipeline.prNumber,
            commitSha: input.pipeline.commitSha,
            findingsCount: input.findings.length,
            workflowId,
            bodyBytes: body.length,
            inlineCommentsWouldPost: inline.summary.posted,
            inlineCommentsWouldSkipUnanchored: inline.summary.skippedUnanchored,
            inlineCommentsWouldSkipWithoutSuggestion:
              inline.summary.skippedWithoutSuggestion,
          },
        );
        return {
          commentId: DRY_RUN_COMMENT_ID,
          created: false,
          inlineReviewId: null,
          inlineCommentsPosted: inline.summary.posted,
          inlineCommentsSkippedUnanchored: inline.summary.skippedUnanchored,
          inlineCommentsSkippedDuplicate: inline.summary.skippedDuplicate,
          inlineCommentsFailed: false,
        };
      }

      const { token } = await createGitHubAppInstallationToken();
      const octokit = new Octokit({ auth: token });
      return runPostReview(octokit, input, workflowId, (error, extra) => {
        captureWithContext(error, input, extra);
      });
    },
  );
}

async function postReviewStatusImpl(
  input: PostReviewStatusInput,
): Promise<PostReviewStatusResult> {
  return await withSpan(
    "prReview.postReviewStatus",
    {
      "pr.owner": input.pipeline.owner,
      "pr.repo": input.pipeline.repo,
      "pr.number": input.pipeline.prNumber,
      "review.status": input.state,
    },
    async () => {
      const workflowId =
        input.workflowId ?? requiredWorkflowId(Context.current().info);
      const normalizedInput: PostReviewStatusInput = {
        ...input,
        workflowId,
      };

      if (!isPostEnabledFromEnv()) {
        const body = renderStatusCommentBody(
          normalizedInput,
          STATUS_COMMENT_MARKER,
        );
        jsonLog(
          "info",
          "postReview status suppressed (PR_REVIEW_POST_ENABLED!=true)",
          {
            prNumber: input.pipeline.prNumber,
            commitSha: input.pipeline.commitSha,
            state: input.state,
            workflowId,
            bodyBytes: body.length,
          },
        );
        return { commentId: DRY_RUN_COMMENT_ID, created: false };
      }

      const { token } = await createGitHubAppInstallationToken();
      const octokit = new Octokit({ auth: token });
      return runPostReviewStatus(octokit, normalizedInput, (error, extra) => {
        captureStatusWithContext(error, normalizedInput, extra);
      });
    },
  );
}

export type PostActivities = typeof postActivities;

export const postActivities = {
  async prReviewPost(input: PostReviewInput): Promise<PostReviewResult> {
    return postReviewImpl(input);
  },
  async prReviewPostStatus(
    input: PostReviewStatusInput,
  ): Promise<PostReviewStatusResult> {
    return postReviewStatusImpl(input);
  },
};
