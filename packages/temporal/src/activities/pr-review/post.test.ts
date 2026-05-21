import { describe, expect, it, mock } from "bun:test";
import {
  buildInlineReviewComments,
  findingMarker,
  inlineFindingMarker,
  markerFor,
  parseFindingMarker,
  renderCommentBody,
  renderStatusCommentBody,
  type PostReviewInput,
} from "./post-render.ts";
import type { PostReviewOctokit } from "./post-github.ts";
import { isPostEnabled, runPostReview, runPostReviewStatus } from "./post.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type { PrFileDiff } from "#shared/pr-review/context.ts";

const PIPELINE: PrReviewPipelineInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 1234,
  commitSha: "abc1234567890abc1234567890abc1234567890ab",
  baseRef: "main",
  headRef: "feature/foo",
  prTitle: "Add foo support",
  prAuthor: "alice",
};

const INPUT: PostReviewInput = {
  pipeline: PIPELINE,
  findings: [],
  changedFiles: [],
};

const WORKFLOW_ID = `pr-review-pipeline-${PIPELINE.owner}-${PIPELINE.repo}-${String(PIPELINE.prNumber)}-${PIPELINE.commitSha}`;

const PATCHED_FILE: PrFileDiff = {
  path: "packages/foo/src/api.ts",
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: [
    "@@ -39,5 +39,6 @@ export function getUser(id: string) {",
    ' const prefix = "user";',
    '-return db.query("select * from users where id=" + id);',
    '+return db.query("select * from users where id=" + id);',
    "+console.log(id);",
    "}",
  ].join("\n"),
};

type ExistingComment = { id: number; body?: string | null };

type MakeOctokitOverrides = {
  issues?: Partial<PostReviewOctokit["rest"]["issues"]>;
  pulls?: Partial<PostReviewOctokit["rest"]["pulls"]>;
  reviewComments?: ExistingComment[];
};

function makeOctokit(
  existingComments: ExistingComment[],
  overrides: MakeOctokitOverrides = {},
): {
  octokit: PostReviewOctokit;
  createCalls: { body: string; issue_number: number }[];
  updateCalls: { comment_id: number; body: string }[];
  reviewCalls: {
    body: string;
    comments: {
      path: string;
      body: string;
      line: number;
      start_line?: number;
    }[];
  }[];
} {
  const createCalls: { body: string; issue_number: number }[] = [];
  const updateCalls: { comment_id: number; body: string }[] = [];
  const reviewCalls: {
    body: string;
    comments: {
      path: string;
      body: string;
      line: number;
      start_line?: number;
    }[];
  }[] = [];

  const createComment =
    overrides.issues?.createComment ??
    (async (params: {
      owner: string;
      repo: string;
      issue_number: number;
      body: string;
    }) => {
      createCalls.push({
        body: params.body,
        issue_number: params.issue_number,
      });
      return { data: { id: 99 } };
    });

  const updateComment =
    overrides.issues?.updateComment ??
    (async (params: {
      owner: string;
      repo: string;
      comment_id: number;
      body: string;
    }) => {
      updateCalls.push({ comment_id: params.comment_id, body: params.body });
      return { data: { id: params.comment_id } };
    });

  const createReview =
    overrides.pulls?.createReview ??
    (async (params: {
      owner: string;
      repo: string;
      pull_number: number;
      commit_id: string;
      event: "COMMENT";
      body: string;
      comments: {
        path: string;
        body: string;
        side: "RIGHT";
        line: number;
        start_side?: "RIGHT";
        start_line?: number;
      }[];
    }) => {
      reviewCalls.push({ body: params.body, comments: params.comments });
      return { data: { id: 313 } };
    });

  const iterator = async function* (
    params: {
      owner: string;
      repo: string;
      per_page: number;
    } & ({ issue_number: number } | { pull_number: number }),
  ) {
    const data =
      "issue_number" in params
        ? existingComments
        : (overrides.reviewComments ?? []);
    yield { data };
  };

  // The activity only references `listComments` as a function pointer
  // passed to `paginate.iterator`; the fake iterator ignores its identity.
  // `PostReviewOctokit["rest"]["issues"]["listComments"]` is `unknown` so
  // any function literal satisfies it directly — no cast needed.
  const listComments: PostReviewOctokit["rest"]["issues"]["listComments"] =
    overrides.issues?.listComments ?? (() => Promise.resolve());

  const listReviewComments: PostReviewOctokit["rest"]["pulls"]["listReviewComments"] =
    overrides.pulls?.listReviewComments ?? (() => Promise.resolve());

  const octokit: PostReviewOctokit = {
    paginate: {
      iterator: (_route, params) => iterator(params),
    },
    rest: {
      issues: {
        listComments,
        createComment,
        updateComment,
      },
      pulls: {
        listReviewComments,
        createReview,
      },
    },
  };

  return { octokit, createCalls, updateCalls, reviewCalls };
}

const noopOnError = (_e: unknown, _extra: Record<string, unknown>): void => {
  // intentionally silent
};

const failingCreateComment: PostReviewOctokit["rest"]["issues"]["createComment"] =
  async (_params) => {
    await Promise.resolve();
    throw new Error("simulated API failure");
  };

const failingCreateReview: PostReviewOctokit["rest"]["pulls"]["createReview"] =
  async (_params) => {
    await Promise.resolve();
    throw new Error("review API down");
  };

describe("foundation: pr-review postReview", () => {
  describe("markerFor", () => {
    it("returns the stable PR-level status marker", () => {
      const marker = markerFor(WORKFLOW_ID);
      expect(marker).toBe("<!-- pr-review-bot-status -->");
      expect(marker.startsWith("<!--")).toBe(true);
      expect(marker.endsWith("-->")).toBe(true);
    });
  });

  // findingMarker / parseFindingMarker tests live in top-level describes
  // below — `max-lines-per-function` caps the parent describe at 200 lines.

  describe("renderCommentBody", () => {
    it("emits the marker on the first line and the empty-findings sentence when no findings are present", () => {
      const marker = markerFor(WORKFLOW_ID);
      const body = renderCommentBody(INPUT, marker);
      const [firstLine, ...rest] = body.split("\n");
      expect(firstLine).toBe(marker);
      const tail = rest.join("\n");
      expect(tail).toContain("pr-review-bot");
      expect(tail).toContain("configured deterministic checks");
    });

    it("groups findings by severity (Critical → Warning → Nit) and renders each finding's metadata", () => {
      const marker = markerFor(WORKFLOW_ID);
      const body = renderCommentBody(
        {
          pipeline: PIPELINE,
          changedFiles: [],
          findings: [
            {
              id: "fA",
              file: "packages/temporal/src/worker.ts",
              lineStart: 10,
              lineEnd: 10,
              kind: "correctness",
              severity: "nit",
              verifier: "none",
              claim: "trivial style nit",
              evidence: "irrelevant evidence text",
              confidence: 0.5,
            },
            {
              id: "fB",
              file: "packages/temporal/src/event-bridge/github-webhook.ts",
              lineStart: 42,
              lineEnd: 44,
              kind: "correctness",
              severity: "critical",
              verifier: "test",
              claim: "race condition between webhook signature check and start",
              evidence:
                "lines 42-44 spawn workflow.start before signature is verified",
              confidence: 0.95,
            },
            {
              id: "fC",
              file: "packages/temporal/src/activities/pr-agent.ts",
              lineStart: 100,
              lineEnd: 100,
              kind: "correctness",
              severity: "warning",
              verifier: "typecheck",
              claim: "missing await on async call",
              evidence: "spawn returns a Promise; result is discarded",
              confidence: 0.8,
            },
          ],
        },
        marker,
      );

      // Critical must appear before Warning, which must appear before Nit.
      const criticalIdx = body.indexOf("## Critical");
      const warningIdx = body.indexOf("## Warning");
      const nitIdx = body.indexOf("## Nit");
      expect(criticalIdx).toBeGreaterThan(0);
      expect(warningIdx).toBeGreaterThan(criticalIdx);
      expect(nitIdx).toBeGreaterThan(warningIdx);

      // Each section's count header reflects the bucket size.
      expect(body).toContain("## Critical (1)");
      expect(body).toContain("## Warning (1)");
      expect(body).toContain("## Nit (1)");

      // Per-finding metadata is rendered.
      expect(body).toContain(
        "packages/temporal/src/event-bridge/github-webhook.ts",
      );
      expect(body).toContain("L42-L44");
      expect(body).toContain("_verifier_: `test`");
      expect(body).toContain("_verification_: not-run");
      expect(body).toContain("_confidence_: 0.95");
      expect(body).toContain("race condition");
    });
  });

  describe("runPostReview", () => {
    it("creates a new comment when no marker is present", async () => {
      const { octokit, createCalls, updateCalls } = makeOctokit([
        { id: 1, body: "some unrelated comment" },
        { id: 2, body: "another unrelated comment" },
      ]);
      const result = await runPostReview(
        octokit,
        INPUT,
        WORKFLOW_ID,
        noopOnError,
      );
      expect(result.created).toBe(true);
      expect(result.commentId).toBe(99);
      expect(createCalls.length).toBe(1);
      expect(updateCalls.length).toBe(0);
      const created = createCalls[0];
      if (created === undefined) {
        throw new Error("expected create call");
      }
      expect(created.issue_number).toBe(PIPELINE.prNumber);
      expect(created.body).toContain("pr-review-bot");
      expect(created.body.startsWith(markerFor(WORKFLOW_ID))).toBe(true);
    });

    it("updates the existing comment when the marker matches (idempotency)", async () => {
      const marker = markerFor(WORKFLOW_ID);
      const { octokit, createCalls, updateCalls } = makeOctokit([
        { id: 7, body: `${marker}\nhello from prReview — phase 1 stub\n` },
        { id: 8, body: "noise" },
      ]);
      const result = await runPostReview(
        octokit,
        INPUT,
        WORKFLOW_ID,
        noopOnError,
      );
      expect(result.created).toBe(false);
      expect(result.commentId).toBe(7);
      expect(createCalls.length).toBe(0);
      expect(updateCalls.length).toBe(1);
      const updated = updateCalls[0];
      if (updated === undefined) {
        throw new Error("expected update call");
      }
      expect(updated.comment_id).toBe(7);
      expect(updated.body.startsWith(marker)).toBe(true);
    });

    it("updates the stable status comment across workflow ids", async () => {
      const otherMarker = markerFor(
        "pr-review-pipeline-other-other-1-deadbeef",
      );
      const { octokit, createCalls, updateCalls } = makeOctokit([
        { id: 11, body: `${otherMarker}\nold stub\n` },
      ]);
      const result = await runPostReview(
        octokit,
        INPUT,
        WORKFLOW_ID,
        noopOnError,
      );
      expect(result.created).toBe(false);
      expect(createCalls.length).toBe(0);
      expect(updateCalls.length).toBe(1);
    });

    it("propagates and reports errors from createComment", async () => {
      const onError = mock(
        (_e: unknown, _extra: Record<string, unknown>): void => {
          // intentionally silent
        },
      );
      const { octokit } = makeOctokit([], {
        issues: { createComment: failingCreateComment },
      });
      await expect(
        runPostReview(octokit, INPUT, WORKFLOW_ID, onError),
      ).rejects.toThrow("simulated API failure");
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("handles null body comments without crashing the marker scan", async () => {
      const { octokit, createCalls } = makeOctokit([
        { id: 13, body: null },
        { id: 14 },
      ]);
      const result = await runPostReview(
        octokit,
        INPUT,
        WORKFLOW_ID,
        noopOnError,
      );
      expect(result.created).toBe(true);
      expect(createCalls.length).toBe(1);
    });
  });
});

describe("isPostEnabled (dry-run gate)", () => {
  it("returns false when the env var is absent (safe default — pipeline ships dry)", () => {
    const env: Record<string, string> = {};
    const value = env["PR_REVIEW_POST_ENABLED"];
    expect(isPostEnabled(value)).toBe(false);
  });

  it("returns false when the env var is the empty string", () => {
    expect(isPostEnabled("")).toBe(false);
  });

  it("returns false for any value that isn't case-insensitive 'true'", () => {
    expect(isPostEnabled("1")).toBe(false);
    expect(isPostEnabled("yes")).toBe(false);
    expect(isPostEnabled("on")).toBe(false);
    expect(isPostEnabled("false")).toBe(false);
    expect(isPostEnabled("True!")).toBe(false);
  });

  it("returns true only for the literal string 'true' (case-insensitive)", () => {
    expect(isPostEnabled("true")).toBe(true);
    expect(isPostEnabled("TRUE")).toBe(true);
    expect(isPostEnabled("True")).toBe(true);
  });
});

describe("PR review lifecycle status comments", () => {
  it("renders draft skipped status", () => {
    const body = renderStatusCommentBody(
      {
        pipeline: PIPELINE,
        state: "draft_skipped",
        workflowId: WORKFLOW_ID,
      },
      markerFor(WORKFLOW_ID),
    );
    expect(body).toContain("Review skipped: draft PR detected");
    expect(body).toContain(WORKFLOW_ID);
  });

  it("renders running and failed statuses", () => {
    const running = renderStatusCommentBody(
      { pipeline: PIPELINE, state: "running", workflowId: WORKFLOW_ID },
      markerFor(WORKFLOW_ID),
    );
    expect(running).toContain("Review running");

    const failed = renderStatusCommentBody(
      {
        pipeline: PIPELINE,
        state: "failed",
        reason: "Error: verifier crashed",
        workflowId: WORKFLOW_ID,
      },
      markerFor(WORKFLOW_ID),
    );
    expect(failed).toContain("Review failed");
    expect(failed).toContain("verifier crashed");
  });

  it("upserts the stable status comment", async () => {
    const marker = markerFor(WORKFLOW_ID);
    const { octokit, updateCalls } = makeOctokit([
      { id: 77, body: `${marker}\nold status` },
    ]);
    const result = await runPostReviewStatus(
      octokit,
      { pipeline: PIPELINE, state: "running", workflowId: WORKFLOW_ID },
      noopOnError,
    );
    expect(result.created).toBe(false);
    expect(result.commentId).toBe(77);
    expect(updateCalls.length).toBe(1);
  });
});

describe("inline PR review comments", () => {
  it("builds a GitHub suggestion block when the suggested range is on added lines", () => {
    const built = buildInlineReviewComments({
      pipeline: PIPELINE,
      findings: [SUGGESTION_FINDING],
      changedFiles: [PATCHED_FILE],
      existingMarkers: new Set<string>(),
    });
    expect(built.comments.length).toBe(1);
    const comment = built.comments[0];
    if (comment === undefined) {
      throw new Error("expected one inline comment");
    }
    expect(comment.line).toBe(40);
    expect(comment.body).toContain("```suggestion");
    expect(comment.body).toContain("parameterized query");
    expect(built.summary.posted).toBe(1);
  });

  it("skips unanchored findings and keeps them for the top-level status body", () => {
    const built = buildInlineReviewComments({
      pipeline: PIPELINE,
      findings: [{ ...SAMPLE_FINDING, lineStart: 200, lineEnd: 200 }],
      changedFiles: [PATCHED_FILE],
      existingMarkers: new Set<string>(),
    });
    expect(built.comments.length).toBe(0);
    expect(built.summary.skippedUnanchored).toBe(1);
  });

  it("skips duplicate inline markers for the same commit", () => {
    const built = buildInlineReviewComments({
      pipeline: PIPELINE,
      findings: [SAMPLE_FINDING],
      changedFiles: [PATCHED_FILE],
      existingMarkers: new Set<string>([
        inlineFindingMarker(SAMPLE_FINDING, PIPELINE.commitSha),
      ]),
    });
    expect(built.comments.length).toBe(0);
    expect(built.summary.skippedDuplicate).toBe(1);
  });

  it("submits inline review comments before updating the status summary", async () => {
    const input: PostReviewInput = {
      pipeline: PIPELINE,
      findings: [SUGGESTION_FINDING],
      changedFiles: [PATCHED_FILE],
    };
    const { octokit, createCalls, reviewCalls } = makeOctokit([]);
    const result = await runPostReview(
      octokit,
      input,
      WORKFLOW_ID,
      noopOnError,
    );
    expect(result.inlineReviewId).toBe(313);
    expect(result.inlineCommentsPosted).toBe(1);
    expect(reviewCalls.length).toBe(1);
    expect(createCalls.length).toBe(1);
    const created = createCalls[0];
    if (created === undefined) {
      throw new Error("expected status comment");
    }
    expect(created.body).toContain("Posted 1 inline comment");
  });

  it("keeps the status comment when inline review submission fails", async () => {
    const input: PostReviewInput = {
      pipeline: PIPELINE,
      findings: [SAMPLE_FINDING],
      changedFiles: [PATCHED_FILE],
    };
    const { octokit, createCalls } = makeOctokit([], {
      pulls: { createReview: failingCreateReview },
    });
    const result = await runPostReview(
      octokit,
      input,
      WORKFLOW_ID,
      noopOnError,
    );
    expect(result.inlineCommentsFailed).toBe(true);
    expect(result.commentId).toBe(99);
    const created = createCalls[0];
    if (created === undefined) {
      throw new Error("expected status comment");
    }
    expect(created.body).toContain("Inline review posting failed");
  });
});

const SAMPLE_FINDING: Finding = {
  id: "f1",
  file: "packages/foo/src/api.ts",
  lineStart: 40,
  lineEnd: 40,
  kind: "security",
  severity: "warning",
  verifier: "none",
  verifierTarget: { kind: "none", reason: "design call" },
  claim: "SQL injection via unparameterized query in `getUser`",
  evidence: "see L42 — string concat into query",
  confidence: 0.8,
};

const SUGGESTION_FINDING: Finding = {
  ...SAMPLE_FINDING,
  id: "f-suggestion",
  lineStart: 40,
  lineEnd: 40,
  suggestion: {
    replacement: 'return db.query("select * from users where id=?", [id]);',
    rationale: "Use a parameterized query for the user-controlled id.",
  },
};

describe("findingMarker (Phase 9 dedup hook)", () => {
  it("emits a valid HTML comment that round-trips through parseFindingMarker", () => {
    const marker = findingMarker(SAMPLE_FINDING);
    expect(marker.startsWith("<!--")).toBe(true);
    expect(marker.endsWith("-->")).toBe(true);
    const parsed = parseFindingMarker(marker);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("security");
    expect(parsed?.file).toBe("packages/foo/src/api.ts");
    expect(parsed?.claim).toContain("SQL injection");
    // Cluster key uses 7-line buckets, so line 40 → bucket 35.
    expect(parsed?.cluster).toBe("packages/foo/src/api.ts|35");
  });

  it("escapes a literal `-->` in the claim so it cannot break out of the comment", () => {
    const malicious: Finding = {
      ...SAMPLE_FINDING,
      claim: "evil --> <script>alert(1)</script>",
    };
    const marker = findingMarker(malicious);
    // The encoded `-->` should not appear in the raw marker — exactly one
    // terminating `-->` is allowed.
    expect(marker.split("-->").length).toBe(2);
    const parsed = parseFindingMarker(marker);
    expect(parsed?.claim).toContain("evil");
  });

  it("truncates very long claims to 80 chars (the marker is a recovery aid, not the body)", () => {
    const long: Finding = {
      ...SAMPLE_FINDING,
      claim: "x".repeat(200),
    };
    const marker = findingMarker(long);
    const parsed = parseFindingMarker(marker);
    expect(parsed?.claim.length).toBeLessThanOrEqual(80);
  });

  it("appears directly above the bullet for every finding in the rendered body", () => {
    const body = renderCommentBody(
      {
        pipeline: PIPELINE,
        findings: [SAMPLE_FINDING],
        changedFiles: [],
      },
      markerFor(WORKFLOW_ID),
    );
    const markerIdx = body.indexOf("<!-- pr-review-finding ");
    const bulletIdx = body.indexOf("- **`packages/foo/src/api.ts`**");
    expect(markerIdx).toBeGreaterThan(-1);
    expect(bulletIdx).toBeGreaterThan(markerIdx);
    // Marker is on its own line — Phase 9's parser splits on \n.
    const markerLine = body.slice(markerIdx).split("\n", 1)[0];
    expect(parseFindingMarker(markerLine ?? "")).not.toBeNull();
  });
});

describe("parseFindingMarker", () => {
  it("returns null for non-marker lines", () => {
    expect(parseFindingMarker("just a regular line")).toBeNull();
    expect(parseFindingMarker("<!-- some other comment -->")).toBeNull();
    expect(parseFindingMarker("")).toBeNull();
  });

  it("returns the parsed triple for a well-formed marker", () => {
    const parsed = parseFindingMarker(
      `<!-- pr-review-finding cluster="a.ts%7C0" kind="security" file="a.ts" claim="x" -->`,
    );
    expect(parsed).toEqual({
      cluster: "a.ts|0",
      kind: "security",
      file: "a.ts",
      claim: "x",
    });
  });
});
