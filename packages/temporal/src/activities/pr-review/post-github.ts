import { RequestError } from "octokit";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import {
  prReviewInlineCommentsTotal,
  prReviewStatusCommentsTotal,
} from "#observability/pr-review-metrics.ts";
import {
  buildExistingInlineMarkerSet,
  buildInlineReviewComments,
  type InlinePostSummary,
  type InlineReviewComment,
  type PostReviewInput,
} from "./post-render.ts";

export type PostReviewStatusResult = {
  commentId: number;
  created: boolean;
};

export type PostReviewOctokit = {
  paginate: {
    iterator: (
      route: unknown,
      params: {
        owner: string;
        repo: string;
        per_page: number;
      } & ({ issue_number: number } | { pull_number: number }),
    ) => AsyncIterable<{
      data: { id: number; body?: string | null }[];
    }>;
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
    pulls: {
      listReviewComments: unknown;
      createReview: (params: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        event: "COMMENT";
        body: string;
        comments: InlineReviewComment[];
      }) => Promise<{ data: { id: number } }>;
    };
  };
};

async function findExistingComment(
  octokit: PostReviewOctokit,
  pipeline: PrReviewPipelineInput,
  marker: string,
): Promise<number | undefined> {
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

async function listExistingInlineComments(
  octokit: PostReviewOctokit,
  pipeline: PrReviewPipelineInput,
): Promise<{ body?: string | null }[]> {
  const comments: { body?: string | null }[] = [];
  const iterator = octokit.paginate.iterator(
    octokit.rest.pulls.listReviewComments,
    {
      owner: pipeline.owner,
      repo: pipeline.repo,
      pull_number: pipeline.prNumber,
      per_page: 100,
    },
  );
  for await (const page of iterator) {
    for (const comment of page.data) {
      comments.push(comment.body === undefined ? {} : { body: comment.body });
    }
  }
  return comments;
}

export async function upsertStatusComment(input: {
  octokit: PostReviewOctokit;
  pipeline: PrReviewPipelineInput;
  body: string;
  marker: string;
}): Promise<PostReviewStatusResult> {
  const existingId = await findExistingComment(
    input.octokit,
    input.pipeline,
    input.marker,
  );
  if (existingId !== undefined) {
    await input.octokit.rest.issues.updateComment({
      owner: input.pipeline.owner,
      repo: input.pipeline.repo,
      comment_id: existingId,
      body: input.body,
    });
    prReviewStatusCommentsTotal.inc({
      repo: input.pipeline.repo,
      state: "updated",
    });
    return { commentId: existingId, created: false };
  }

  const created = await input.octokit.rest.issues.createComment({
    owner: input.pipeline.owner,
    repo: input.pipeline.repo,
    issue_number: input.pipeline.prNumber,
    body: input.body,
  });
  prReviewStatusCommentsTotal.inc({
    repo: input.pipeline.repo,
    state: "created",
  });
  return { commentId: created.data.id, created: true };
}

export async function postInlineReview(input: {
  octokit: PostReviewOctokit;
  review: PostReviewInput;
  onError: (error: unknown, extra: Record<string, unknown>) => void;
}): Promise<{ reviewId: number | null; summary: InlinePostSummary }> {
  const existing = await listExistingInlineComments(
    input.octokit,
    input.review.pipeline,
  );
  const built = buildInlineReviewComments({
    pipeline: input.review.pipeline,
    findings: input.review.findings,
    changedFiles: input.review.changedFiles,
    existingMarkers: buildExistingInlineMarkerSet(existing),
  });

  if (built.comments.length === 0) {
    prReviewInlineCommentsTotal.inc({
      repo: input.review.pipeline.repo,
      outcome: "none",
    });
    return { reviewId: null, summary: built.summary };
  }

  try {
    const review = await input.octokit.rest.pulls.createReview({
      owner: input.review.pipeline.owner,
      repo: input.review.pipeline.repo,
      pull_number: input.review.pipeline.prNumber,
      commit_id: input.review.pipeline.commitSha,
      event: "COMMENT",
      body: "pr-review-bot found issues that are anchored inline below.",
      comments: built.comments,
    });
    prReviewInlineCommentsTotal.inc(
      { repo: input.review.pipeline.repo, outcome: "posted" },
      built.comments.length,
    );
    incrementSkippedInlineMetrics(input.review.pipeline.repo, built.summary);
    return { reviewId: review.data.id, summary: built.summary };
  } catch (error: unknown) {
    const status = error instanceof RequestError ? error.status : undefined;
    input.onError(error, { httpStatus: status, phase: "inline-review" });
    prReviewInlineCommentsTotal.inc({
      repo: input.review.pipeline.repo,
      outcome: "failed",
    });
    return {
      reviewId: null,
      summary: {
        ...built.summary,
        failed: true,
        failureMessage: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function incrementSkippedInlineMetrics(
  repo: string,
  summary: InlinePostSummary,
): void {
  if (summary.skippedUnanchored > 0) {
    prReviewInlineCommentsTotal.inc(
      { repo, outcome: "skipped_unanchored" },
      summary.skippedUnanchored,
    );
  }
  if (summary.skippedDuplicate > 0) {
    prReviewInlineCommentsTotal.inc(
      { repo, outcome: "skipped_duplicate" },
      summary.skippedDuplicate,
    );
  }
}
