import { Context } from "@temporalio/activity";
import { Octokit, RequestError } from "octokit";
import * as Sentry from "@sentry/bun";
import { withSpan } from "#observability/tracing.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

const COMPONENT = "pr-review-pipeline";
const PHASE_1_STUB_BODY = "hello from prReview — phase 1 stub";

/**
 * Marker comment that identifies prior comments from this pipeline so the
 * post activity can edit-in-place instead of duplicating on every PR push.
 * Includes the workflow id so cross-PR confusion is impossible.
 */
const COMMENT_MARKER_PREFIX = "<!-- pr-review-pipeline";

export type PostReviewInput = {
  pipeline: PrReviewPipelineInput;
  findings: Finding[];
};

export type PostReviewResult = {
  /** Numeric id of the issue comment created or updated. */
  commentId: number;
  /** Whether the activity created a new comment (true) or edited an existing one (false). */
  created: boolean;
};

/**
 * Minimal slice of the Octokit surface used by this activity. Defined so
 * tests can supply a fake without spinning up a real HTTP client.
 *
 * `listComments` is typed as `unknown` because the activity only uses it as
 * a route pointer fed to `paginate.iterator`; the real Octokit method has a
 * deeply-conditional signature generated from the OpenAPI spec, but the
 * fake paginator ignores its identity entirely. Widening to `unknown` keeps
 * the contract honest without forcing tests to replicate a 200-line method
 * signature (and without leaning on a forbidden `as`-assertion to coerce a
 * stub into it).
 */
export type PostReviewOctokit = {
  paginate: {
    iterator: (
      route: unknown,
      params: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page: number;
      },
    ) => AsyncIterable<{ data: { id: number; body?: string | null }[] }>;
  };
  rest: {
    issues: {
      listComments: unknown;
      createComment: (params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }) => Promise<{ data: { id: number } }>;
      updateComment: (params: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
      }) => Promise<{ data: { id: number } }>;
    };
  };
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

export function markerFor(workflowId: string): string {
  return `${COMMENT_MARKER_PREFIX} id="${workflowId}" -->`;
}

export function renderCommentBody(
  _input: PostReviewInput,
  marker: string,
): string {
  // Phase 1 emits a literal stub regardless of findings count so the smoke
  // test can match on the exact string. Real implementation will group by
  // severity bucket and inline verification evidence.
  return `${marker}\n${PHASE_1_STUB_BODY}\n`;
}

async function findExistingComment(
  octokit: PostReviewOctokit,
  input: PostReviewInput,
  marker: string,
): Promise<number | undefined> {
  const { pipeline } = input;
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner: pipeline.owner,
    repo: pipeline.repo,
    issue_number: pipeline.prNumber,
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const comment of page.data) {
      if (typeof comment.body === "string" && comment.body.startsWith(marker)) {
        return comment.id;
      }
    }
  }
  return undefined;
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
      workflowId: info.workflowExecution.workflowId,
      runId: info.workflowExecution.runId,
      attempt: info.attempt,
      owner: input.pipeline.owner,
      repo: input.pipeline.repo,
      prNumber: input.pipeline.prNumber,
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
  const body = renderCommentBody(input, marker);

  jsonLog("info", "postReview invoked", {
    prNumber: input.pipeline.prNumber,
    commitSha: input.pipeline.commitSha,
    findingsCount: input.findings.length,
    workflowId,
  });

  try {
    const existingId = await findExistingComment(octokit, input, marker);
    if (existingId !== undefined) {
      await octokit.rest.issues.updateComment({
        owner: input.pipeline.owner,
        repo: input.pipeline.repo,
        comment_id: existingId,
        body,
      });
      jsonLog("info", "Updated existing PR-review comment in place", {
        commentId: existingId,
        prNumber: input.pipeline.prNumber,
      });
      return { commentId: existingId, created: false };
    }

    const created = await octokit.rest.issues.createComment({
      owner: input.pipeline.owner,
      repo: input.pipeline.repo,
      issue_number: input.pipeline.prNumber,
      body,
    });
    jsonLog("info", "Created PR-review stub comment", {
      commentId: created.data.id,
      prNumber: input.pipeline.prNumber,
    });
    return { commentId: created.data.id, created: true };
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
      // GH_TOKEN is the same canonical token wired in worker.ts (1Password Connect
      // field `GH_TOKEN`). Keep this distinct from the OAuth token used by the
      // claude CLI — different auth surface, different lifecycle.
      const token = Bun.env["GH_TOKEN"];
      if (token === undefined || token === "") {
        throw new Error("GH_TOKEN is required to post review comments");
      }

      const octokit = new Octokit({ auth: token });
      const workflowId = Context.current().info.workflowExecution.workflowId;
      return runPostReview(octokit, input, workflowId, (error, extra) => {
        captureWithContext(error, input, extra);
      });
    },
  );
}

export type PostActivities = typeof postActivities;

export const postActivities = {
  async prReviewPost(input: PostReviewInput): Promise<PostReviewResult> {
    return postReviewImpl(input);
  },
};
