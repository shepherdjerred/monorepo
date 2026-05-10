import { describe, expect, it, mock } from "bun:test";
import {
  markerFor,
  renderCommentBody,
  runPostReview,
  type PostReviewInput,
  type PostReviewOctokit,
} from "./post.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

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
};

const WORKFLOW_ID = `pr-review-pipeline-${PIPELINE.owner}-${PIPELINE.repo}-${String(PIPELINE.prNumber)}-${PIPELINE.commitSha}`;

type ExistingComment = { id: number; body?: string | null };

function makeOctokit(
  existingComments: ExistingComment[],
  overrides: Partial<PostReviewOctokit["rest"]["issues"]> = {},
): {
  octokit: PostReviewOctokit;
  createCalls: { body: string; issue_number: number }[];
  updateCalls: { comment_id: number; body: string }[];
} {
  const createCalls: { body: string; issue_number: number }[] = [];
  const updateCalls: { comment_id: number; body: string }[] = [];

  const createComment =
    overrides.createComment ??
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
    overrides.updateComment ??
    (async (params: {
      owner: string;
      repo: string;
      comment_id: number;
      body: string;
    }) => {
      updateCalls.push({ comment_id: params.comment_id, body: params.body });
      return { data: { id: params.comment_id } };
    });

  // Single-page iterator is enough for these unit tests; real Octokit
  // paginates by `Link` header but the activity's marker scan logic doesn't
  // care which page the comment shows up on.
  const iterator = async function* () {
    yield { data: existingComments };
  };

  // The activity only references `listComments` as a function pointer
  // passed to `paginate.iterator`; the fake iterator ignores its identity.
  // `PostReviewOctokit["rest"]["issues"]["listComments"]` is `unknown` so
  // any function literal satisfies it directly — no cast needed.
  const listComments: PostReviewOctokit["rest"]["issues"]["listComments"] =
    overrides.listComments ?? (() => Promise.resolve());

  const octokit: PostReviewOctokit = {
    paginate: {
      iterator: () => iterator(),
    },
    rest: {
      issues: {
        listComments,
        createComment,
        updateComment,
      },
    },
  };

  return { octokit, createCalls, updateCalls };
}

const noopOnError = (_e: unknown, _extra: Record<string, unknown>): void => {
  // intentionally silent
};

const failingCreateComment: PostReviewOctokit["rest"]["issues"]["createComment"] =
  async (_params) => {
    await Promise.resolve();
    throw new Error("simulated API failure");
  };

describe("foundation: pr-review postReview", () => {
  describe("markerFor", () => {
    it("embeds the workflow id so cross-PR comments can't collide", () => {
      const marker = markerFor(WORKFLOW_ID);
      expect(marker).toContain(WORKFLOW_ID);
      expect(marker.startsWith("<!--")).toBe(true);
      expect(marker.endsWith("-->")).toBe(true);
    });
  });

  describe("renderCommentBody", () => {
    it("emits the phase-1 stub body with the marker on the first line", () => {
      const marker = markerFor(WORKFLOW_ID);
      const body = renderCommentBody(INPUT, marker);
      const [firstLine, ...rest] = body.split("\n");
      expect(firstLine).toBe(marker);
      expect(rest.join("\n")).toContain("hello from prReview — phase 1 stub");
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
      expect(created.body).toContain("hello from prReview — phase 1 stub");
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

    it("ignores comments with a marker for a different workflow id", async () => {
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
      expect(result.created).toBe(true);
      expect(createCalls.length).toBe(1);
      expect(updateCalls.length).toBe(0);
    });

    it("propagates and reports errors from createComment", async () => {
      const onError = mock(
        (_e: unknown, _extra: Record<string, unknown>): void => {
          // intentionally silent
        },
      );
      const { octokit } = makeOctokit([], {
        createComment: failingCreateComment,
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
