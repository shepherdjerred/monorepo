import { afterEach, expect, test, vi } from "vitest";
import { fetchCleanCompletionComment } from "./github-clean-comments.ts";
import { resolveReviewState } from "./github.ts";
import { evaluateGate } from "./gate.ts";
import {
  coderabbitProvider,
  parseCoderabbitCleanHead,
} from "./providers/coderabbit.ts";

const head = "6cbcd33966e8a5b5522a22f41b86304109be9901";
const older = "5e7bda1a448ff462650fa16965f249cf15237c0d";
const pushed = "2026-10-01T06:43:00Z";
const completed = "2026-10-01T06:48:00Z";
// Trimmed completion artifacts observed on PR #3364. Commit links outside the
// final coverage marker are deliberately irrelevant to this contract.
const body = `<!-- recent_review_start -->
No actionable comments were generated in the recent review. 🎉
<!-- recent_review_end -->
<!-- final_review_risk_coverage:{"sourceCommitId":"${head}","coveredCommitId":"${head}","kind":"reviewed"} -->`;
const input = {
  repo: "o/r",
  number: 1,
  prNumber: 1,
  token: "token",
  provider: coderabbitProvider,
  head,
  headPushedAt: pushed,
};
const comment = {
  body,
  updated_at: completed,
  user: { login: "coderabbitai[bot]" },
};

afterEach(() => vi.restoreAllMocks());

function mockComments(comments: unknown, reviews: unknown = []): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: string | URL | Request) =>
        Response.json(
          (url instanceof Request ? url.url : url.toString()).includes(
            "/reviews?",
          )
            ? reviews
            : comments,
        ),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
}

test("resolves a completed clean comment without a formal PR review", async () => {
  mockComments([comment]);
  await expect(resolveReviewState(input)).resolves.toMatchObject({
    state: "reviewed",
    completionSignal: "issue-comment",
    reviewedCommit: head,
    reviewedAt: completed,
  });
});

test("clean comment completion does not override an unresolved critical thread", async () => {
  mockComments([comment]);
  const completion = await resolveReviewState(input);
  const decision = evaluateGate({
    head,
    provider: coderabbitProvider,
    reviewState: completion.state,
    policy: {
      maxBlockingPriority: 2,
      alwaysBlockingPriority: 1,
      lowSeverity: "always",
    },
    threads: [
      {
        authorLogin: "coderabbitai[bot]",
        isResolved: false,
        isOutdated: false,
        path: "policy.tf",
        line: 1,
        url: null,
        priority: 0,
        title: "Critical finding",
        threadId: "thread-1",
        commentId: null,
        raisedInReview: null,
      },
    ],
  });
  expect(decision.state).toBe("failed");
});

test("completion lookup scans later comment pages", async () => {
  let requests = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        requests += 1;
        return requests === 1
          ? Response.json([], {
              headers: {
                Link: '<https://api.github.com/repos/o/r/issues/1/comments?page=2>; rel="next"',
              },
            })
          : Response.json([comment]);
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  await expect(fetchCleanCompletionComment(input)).resolves.toEqual({
    reviewedAt: completed,
  });
  expect(requests).toBe(2);
});

test.each([
  [
    "wrong author",
    { ...comment, user: { login: "not-coderabbitai[bot]" } },
    pushed,
  ],
  ["stale comment", { ...comment, updated_at: "2026-10-01T06:42:00Z" }, pushed],
  ["unknown push", comment, null],
  [
    "old coverage rewritten after push",
    { ...comment, body: body.replaceAll(head, older) },
    pushed,
  ],
])("rejects %s", async (_description, candidate, headPushedAt) => {
  mockComments([candidate]);
  await expect(
    fetchCleanCompletionComment({ ...input, headPushedAt }),
  ).resolves.toBeNull();
});

test.each([
  ["walkthrough only", "Walkthrough of changes"],
  [
    "coverage without clean declaration",
    body.replace(
      "No actionable comments were generated in the recent review.",
      "Actionable comments posted: 1",
    ),
  ],
  [
    "partial coverage",
    body.replace(`coveredCommitId":"${head}`, `coveredCommitId":"${older}`),
  ],
  ["in-progress metadata", body.replace('"reviewed"', '"pending"')],
  [
    "malformed metadata",
    body.replace('{"sourceCommitId"', '{broken:"sourceCommitId"'),
  ],
  ["duplicate coverage", `${body}\n${body}`],
  ["critical finding", `${body}\n_🔴 Critical_`],
  ["major finding", `${body}\n_🟠 Major_`],
  ["minor finding", `${body}\n_🟡 Minor_`],
])("does not call %s a clean review", (_description, candidate) => {
  expect(parseCoderabbitCleanHead(candidate)).toBeNull();
});

test("latest coverage cannot be masked by an older clean comment", async () => {
  mockComments([
    comment,
    {
      ...comment,
      updated_at: "2026-10-01T06:49:00Z",
      body: body.replace('"reviewed"', '"pending"'),
    },
  ]);
  await expect(fetchCleanCompletionComment(input)).resolves.toBeNull();
});

test("formal review at head still wins over missing comment completion", async () => {
  mockComments(
    [],
    [
      {
        user: { login: "coderabbitai[bot]" },
        commit_id: head,
        submitted_at: completed,
        state: "COMMENTED",
        id: 1,
      },
    ],
  );
  await expect(resolveReviewState(input)).resolves.toMatchObject({
    state: "reviewed",
    completionSignal: "review-at-head",
    reviewedCommit: head,
  });
});

test("unexpected GitHub comment response fails loudly", async () => {
  mockComments({ unexpected: true });
  await expect(fetchCleanCompletionComment(input)).rejects.toThrow(
    "was not an array",
  );
});

test.each([null, "bad"])(
  "invalid completion timestamp %s fails loudly",
  async (updatedAt) => {
    mockComments([{ ...comment, updated_at: updatedAt }]);
    await expect(fetchCleanCompletionComment(input)).rejects.toThrow(
      "no valid updated_at",
    );
  },
);
