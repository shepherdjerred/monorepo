import { describe, expect, it } from "bun:test";
import {
  upsertSummaryComment,
  type OctokitForUpsert,
} from "./pr-summary-comment.ts";

const MARKER = "<!-- pr-summary -->";

type FakeComment = {
  id: number;
  body: string | null;
};

type FakeCall = {
  kind: "create" | "update";
  params: { body: string; commentId?: number };
};

function buildFakeOctokit(input: {
  pages: FakeComment[][];
  createReturn?: { id: number; html_url: string };
  updateReturn?: { id: number; html_url: string };
}): { octokit: OctokitForUpsert; calls: FakeCall[] } {
  const calls: FakeCall[] = [];

  const octokit: OctokitForUpsert = {
    listComments: async () => ({ data: input.pages[0] ?? [] }),
    createComment: async (params) => {
      calls.push({ kind: "create", params: { body: params.body } });
      return {
        data: input.createReturn ?? { id: 999, html_url: "https://gh/created" },
      };
    },
    updateComment: async (params) => {
      calls.push({
        kind: "update",
        params: { body: params.body, commentId: params.comment_id },
      });
      return {
        data: input.updateReturn ?? { id: 111, html_url: "https://gh/updated" },
      };
    },
    paginateListComments: () =>
      (async function* () {
        for (const page of input.pages) {
          yield { data: page };
        }
      })(),
  };

  return { octokit, calls };
}

describe("upsertSummaryComment", () => {
  it("throws if the body is missing the marker (defends against an off-prompt model)", async () => {
    const { octokit } = buildFakeOctokit({ pages: [[]] });
    await expect(
      upsertSummaryComment({
        octokit,
        owner: "o",
        repo: "r",
        prNumber: 1,
        body: "no marker here",
        marker: MARKER,
      }),
    ).rejects.toThrow(/marker/i);
  });

  it("creates a new comment when none with the marker exists", async () => {
    const { octokit, calls } = buildFakeOctokit({
      pages: [[{ id: 1, body: "some unrelated user comment" }]],
      createReturn: { id: 42, html_url: "https://gh/c/42" },
    });

    const result = await upsertSummaryComment({
      octokit,
      owner: "o",
      repo: "r",
      prNumber: 5,
      body: `${MARKER}\n\nbody`,
      marker: MARKER,
    });

    expect(result).toEqual({
      action: "created",
      commentId: 42,
      htmlUrl: "https://gh/c/42",
    });
    expect(calls).toHaveLength(1);
    const first = calls[0];
    if (first === undefined) throw new Error("missing call");
    expect(first.kind).toBe("create");
    expect(first.params.body).toContain(MARKER);
  });

  it("edits in place when a marker comment exists", async () => {
    const { octokit, calls } = buildFakeOctokit({
      pages: [
        [
          { id: 1, body: "unrelated" },
          { id: 77, body: `${MARKER}\n\nold body` },
        ],
      ],
      updateReturn: { id: 77, html_url: "https://gh/c/77" },
    });

    const result = await upsertSummaryComment({
      octokit,
      owner: "o",
      repo: "r",
      prNumber: 5,
      body: `${MARKER}\n\nnew body`,
      marker: MARKER,
    });

    expect(result.action).toBe("updated");
    expect(result.commentId).toBe(77);
    expect(calls).toHaveLength(1);
    const first = calls[0];
    if (first === undefined) throw new Error("missing call");
    expect(first.kind).toBe("update");
    expect(first.params.commentId).toBe(77);
    expect(first.params.body).toContain("new body");
  });

  it("walks across paginated pages to find the marker", async () => {
    const { octokit, calls } = buildFakeOctokit({
      pages: [
        [{ id: 1, body: "unrelated" }],
        [{ id: 2, body: "still unrelated" }],
        [{ id: 88, body: `${MARKER}\n\nfound on page 3` }],
      ],
      updateReturn: { id: 88, html_url: "https://gh/c/88" },
    });

    const result = await upsertSummaryComment({
      octokit,
      owner: "o",
      repo: "r",
      prNumber: 5,
      body: `${MARKER}\n\nbody`,
      marker: MARKER,
    });

    expect(result.action).toBe("updated");
    expect(result.commentId).toBe(88);
    const first = calls[0];
    if (first === undefined) throw new Error("missing call");
    expect(first.kind).toBe("update");
  });

  it("handles a comment with null body without crashing", async () => {
    const { octokit } = buildFakeOctokit({
      pages: [
        [
          // GitHub can return body: null for deleted-then-restored comments.
          // The helper must skip these rather than crashing on .includes.
          { id: 1, body: null },
          { id: 99, body: `${MARKER}\n\nx` },
        ],
      ],
      updateReturn: { id: 99, html_url: "https://gh/c/99" },
    });

    const result = await upsertSummaryComment({
      octokit,
      owner: "o",
      repo: "r",
      prNumber: 5,
      body: `${MARKER}\n\nbody`,
      marker: MARKER,
    });
    expect(result.commentId).toBe(99);
  });
});
