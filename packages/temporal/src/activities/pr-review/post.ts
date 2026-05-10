import { Context } from "@temporalio/activity";
import { Octokit, RequestError } from "octokit";
import * as Sentry from "@sentry/bun";
import { withSpan } from "#observability/tracing.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

const COMPONENT = "pr-review-pipeline";

/**
 * Body emitted when the pipeline runs but produces zero findings — the
 * model judged the PR clean. We still post (rather than leaving the
 * marker missing) so reviewers can see the bot ran and reached a verdict.
 */
const EMPTY_FINDINGS_BODY =
  "_pr-review-bot: no substantive correctness issues found in this diff. " +
  "(Future phases will surface security, performance, convention, and deps findings too.)_";

/**
 * Marker comment that identifies prior comments from this pipeline so the
 * post activity can edit-in-place instead of duplicating on every PR push.
 * Includes the workflow id so cross-PR confusion is impossible.
 */
const COMMENT_MARKER_PREFIX = "<!-- pr-review-pipeline";

/**
 * Display labels for severity sections, ordered worst-first so reviewers see
 * the critical issues at the top of the comment.
 */
const SEVERITY_SECTIONS: { severity: Finding["severity"]; heading: string }[] =
  [
    { severity: "critical", heading: "Critical" },
    { severity: "warning", heading: "Warning" },
    { severity: "nit", heading: "Nit" },
  ];

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

function renderFinding(finding: Finding): string {
  const lineRange =
    finding.lineStart === finding.lineEnd
      ? `L${String(finding.lineStart)}`
      : `L${String(finding.lineStart)}-L${String(finding.lineEnd)}`;
  const lines: string[] = [];
  lines.push(`- **\`${finding.file}\`** ${lineRange} — ${finding.claim}`);
  lines.push(
    `  - _kind_: ${finding.kind}; _verifier_: \`${finding.verifier}\`; _confidence_: ${finding.confidence.toFixed(2)}`,
  );
  lines.push(`  - _evidence_: ${finding.evidence}`);
  return lines.join("\n");
}

export function renderCommentBody(
  input: PostReviewInput,
  marker: string,
): string {
  const lines: string[] = [];
  lines.push(marker);
  lines.push("");
  lines.push("**pr-review-bot** (Phase 2 — correctness specialist baseline)");
  lines.push("");

  if (input.findings.length === 0) {
    lines.push(EMPTY_FINDINGS_BODY);
    lines.push("");
    return lines.join("\n");
  }

  // Group by severity, worst first. Empty sections are skipped entirely.
  const bySeverity = new Map<Finding["severity"], Finding[]>();
  for (const f of input.findings) {
    const bucket = bySeverity.get(f.severity);
    if (bucket === undefined) {
      bySeverity.set(f.severity, [f]);
    } else {
      bucket.push(f);
    }
  }

  for (const section of SEVERITY_SECTIONS) {
    const bucket = bySeverity.get(section.severity);
    if (bucket === undefined || bucket.length === 0) {
      continue;
    }
    lines.push(`## ${section.heading} (${String(bucket.length)})`);
    lines.push("");
    for (const finding of bucket) {
      lines.push(renderFinding(finding));
      lines.push("");
    }
  }

  return lines.join("\n");
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
      const workflowId = Context.current().info.workflowExecution.workflowId;

      if (!isPostEnabledFromEnv()) {
        // Dry-run: render the body for the log so operators can see what
        // *would* have been posted, but skip the GitHub mutation entirely.
        // The synthetic id signals downstream activities to skip their
        // post-dependent work.
        const marker = markerFor(workflowId);
        const body = renderCommentBody(input, marker);
        jsonLog(
          "info",
          "postReview suppressed (PR_REVIEW_POST_ENABLED!=true)",
          {
            prNumber: input.pipeline.prNumber,
            commitSha: input.pipeline.commitSha,
            findingsCount: input.findings.length,
            workflowId,
            bodyBytes: body.length,
          },
        );
        return { commentId: DRY_RUN_COMMENT_ID, created: false };
      }

      // GH_TOKEN is the same canonical token wired in worker.ts (1Password Connect
      // field `GH_TOKEN`). Keep this distinct from the OAuth token used by the
      // claude CLI — different auth surface, different lifecycle.
      const token = Bun.env["GH_TOKEN"];
      if (token === undefined || token === "") {
        throw new Error("GH_TOKEN is required to post review comments");
      }

      const octokit = new Octokit({ auth: token });
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
