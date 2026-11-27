import { describe, expect, it, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import type { ReviewThread } from "@shepherdjerred/code-review";
import type { ReviewStateResult } from "@shepherdjerred/code-review/github";
import { DEFAULT_CODE_REVIEW_SETTINGS } from "#shared/ci/code-review.ts";
import { register } from "#observability/metrics.ts";
import { createCodeReviewActivities } from "./code-review.ts";
import type {
  CodeReviewActivityDeps,
  CodeReviewTemporalClient,
  PullRequestMetadata,
} from "./code-review-types.ts";

function makePr(
  overrides: Partial<PullRequestMetadata> = {},
): PullRequestMetadata {
  return {
    state: "open",
    draft: false,
    baseRef: "main",
    headSha: "head-sha-1",
    author: { login: "shepherdjerred", type: "User" },
    ...overrides,
  };
}

function makeReviewState(
  overrides: Partial<ReviewStateResult> = {},
): ReviewStateResult {
  return {
    state: "reviewing",
    completionSignal: "none",
    reviewedCommit: null,
    reviewedAt: null,
    staleReaction: false,
    skipReason: null,
    blockedReason: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    authorLogin: "coderabbitai",
    isResolved: false,
    isOutdated: false,
    path: "src/foo.ts",
    line: 12,
    url: "https://github.com/shepherdjerred/monorepo/pull/42#discussion_r1",
    priority: 1,
    title: "Null dereference on missing payload",
    threadId: "PRRT_1",
    commentId: null,
    raisedInReview: { ordinal: 1, hadBlockingSeverity: true },
    ...overrides,
  };
}

function makeBaseDeps(
  overrides: CodeReviewActivityDeps = {},
): CodeReviewActivityDeps {
  return {
    createInstallationToken: () =>
      Promise.resolve({
        token: "ghs_install_token",
        expiresAt: new Date(Date.now() + 600_000),
      }),
    getReviewToken: () => "ghp_review_token",
    getRuntimeConfig: () =>
      Promise.resolve({
        enabled: true,
        settings: DEFAULT_CODE_REVIEW_SETTINGS,
      }),
    getPullRequest: () => Promise.resolve(makePr()),
    fetchHeadPushedAt: () => Promise.resolve("2026-11-24T00:00:00Z"),
    resolveReviewState: () => Promise.resolve(makeReviewState()),
    fetchSharedProviderThreads: () =>
      Promise.resolve({
        byProvider: new Map(),
        headRefOid: "head-sha-1",
      }),
    requestReviewAtHead: () => Promise.resolve("requested"),
    ...overrides,
  };
}

describe("codeReviewActivities.inspectPrReviewContext", () => {
  it.each([
    [{ state: "closed" as const }, "closed"],
    [{ draft: true }, "draft"],
    [{ baseRef: "release/v1" }, "base-not-main"],
    [{ headSha: "different-sha" }, "head-changed"],
  ])(
    "returns inactive when PR metadata fails gate (%j -> %s)",
    async (patch, expectedReason) => {
      const activities = createCodeReviewActivities(
        makeBaseDeps({
          getPullRequest: () => Promise.resolve(makePr(patch)),
        }),
      );
      const result = await activities.inspectPrReviewContext({
        owner: "shepherdjerred",
        repo: "monorepo",
        prNumber: 42,
        expectedHeadSha: "head-sha-1",
      });
      expect(result).toEqual({ active: false, reason: expectedReason });
    },
  );

  it("resolves all 6 provider completions strictly before fetching shared threads", async () => {
    const callOrder: string[] = [];
    const activities = createCodeReviewActivities(
      makeBaseDeps({
        resolveReviewState: ({ provider }) => {
          callOrder.push(`resolve:${provider.id}`);
          return Promise.resolve(
            provider.id === "coderabbit"
              ? makeReviewState({
                  state: "reviewed",
                  reviewedCommit: "head-sha-1",
                })
              : makeReviewState({ priorRound: provider.id === "codex" }),
          );
        },
        fetchSharedProviderThreads: () => {
          callOrder.push("threads");
          return Promise.resolve({
            byProvider: new Map([
              [
                "codex",
                [
                  makeThread({
                    authorLogin: "chatgpt-codex-connector",
                    priority: 0,
                  }),
                ],
              ],
            ]),
            headRefOid: "head-sha-1",
          });
        },
      }),
    );

    const result = await activities.inspectPrReviewContext({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      expectedHeadSha: "head-sha-1",
    });

    expect(callOrder.at(-1)).toBe("threads");
    expect(callOrder).toHaveLength(7);
    expect(result).toMatchObject({
      active: true,
      p0VetoCount: 1,
      priorRoundCompleted: true,
      completedAtHead: {
        providerId: "coderabbit",
        blockingCount: 0,
      },
    });
  });

  it("detects priorRoundCompleted only from outdated threads, not current-head reviewing threads", async () => {
    let outdated = false;
    const activities = createCodeReviewActivities(
      makeBaseDeps({
        fetchSharedProviderThreads: () =>
          Promise.resolve({
            byProvider: new Map([
              [
                "greptile",
                [
                  makeThread({
                    authorLogin: "greptile-apps",
                    priority: 1,
                    isOutdated: outdated,
                  }),
                ],
              ],
            ]),
            headRefOid: "head-sha-1",
          }),
      }),
    );

    const reviewingCurrentHead = await activities.inspectPrReviewContext({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      expectedHeadSha: "head-sha-1",
    });
    expect(reviewingCurrentHead).toMatchObject({
      active: true,
      priorRoundCompleted: false,
      p0VetoCount: 0,
    });

    outdated = true;
    const outdatedEarlierHead = await activities.inspectPrReviewContext({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      expectedHeadSha: "head-sha-1",
    });
    expect(outdatedEarlierHead).toMatchObject({
      active: true,
      priorRoundCompleted: true,
      p0VetoCount: 0,
    });
  });
});

describe("codeReviewActivities.triggerAndObserveProvider", () => {
  it("throws non-retryable ApplicationFailure when GITHUB_REVIEW_TOKEN is missing", async () => {
    const activities = createCodeReviewActivities(
      makeBaseDeps({
        getReviewToken: () => "   ",
      }),
    );

    await expect(
      activities.triggerAndObserveProvider({
        owner: "shepherdjerred",
        repo: "monorepo",
        prNumber: 42,
        headSha: "head-sha-1",
        headPushedAt: "2026-11-24T00:00:00Z",
        providerId: "coderabbit",
        attempt: 1,
        shouldRequest: true,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ApplicationFailure && err.nonRetryable === true,
    );
  });

  it("posts review request only when shouldRequest && state === reviewing && unblocked", async () => {
    const requestReviewAtHead = vi.fn(async () => "requested" as const);
    const activities = createCodeReviewActivities(
      makeBaseDeps({
        requestReviewAtHead,
      }),
    );

    const res1 = await activities.triggerAndObserveProvider({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      headSha: "head-sha-1",
      headPushedAt: "2026-11-24T00:00:00Z",
      providerId: "coderabbit",
      attempt: 1,
      shouldRequest: true,
    });
    expect(res1).toMatchObject({
      active: true,
      reviewState: "reviewing",
      requestOutcome: "requested",
    });
    expect(requestReviewAtHead).toHaveBeenCalledTimes(1);

    const res2 = await activities.triggerAndObserveProvider({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      headSha: "head-sha-1",
      headPushedAt: "2026-11-24T00:00:00Z",
      providerId: "coderabbit",
      attempt: 1,
      shouldRequest: false,
    });
    expect(res2).toMatchObject({
      active: true,
      requestOutcome: null,
    });
    expect(requestReviewAtHead).toHaveBeenCalledTimes(1);
  });
});

describe("codeReviewActivities.verifyAndCheckBlockingThreads", () => {
  it("fails with p0-veto when any provider has an unresolved P0", async () => {
    const activities = createCodeReviewActivities(
      makeBaseDeps({
        resolveReviewState: () =>
          Promise.resolve(
            makeReviewState({
              state: "reviewed",
              reviewedCommit: "head-sha-1",
            }),
          ),
        fetchSharedProviderThreads: () =>
          Promise.resolve({
            byProvider: new Map([
              [
                "codex",
                [
                  makeThread({
                    authorLogin: "chatgpt-codex-connector",
                    priority: 0,
                  }),
                ],
              ],
            ]),
            headRefOid: "head-sha-1",
          }),
      }),
    );

    const result = await activities.verifyAndCheckBlockingThreads({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      headSha: "head-sha-1",
      providerId: "coderabbit",
    });
    expect(result).toEqual({
      active: true,
      passed: false,
      failureReason: "p0-veto",
      description: "1 unresolved P0 finding(s) (Codex)",
    });
  });

  it("fails with review-withdrawn if the assigned provider review was dismissed", async () => {
    const activities = createCodeReviewActivities(
      makeBaseDeps({
        resolveReviewState: () =>
          Promise.resolve(makeReviewState({ state: "reviewing" })),
      }),
    );

    const result = await activities.verifyAndCheckBlockingThreads({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      headSha: "head-sha-1",
      providerId: "coderabbit",
    });
    expect(result).toMatchObject({
      active: true,
      passed: false,
      failureReason: "review-withdrawn",
    });
  });

  it("blocks on P1 findings and passes when only P2/P3 advisory findings exist", async () => {
    let priority = 1;
    const activities = createCodeReviewActivities(
      makeBaseDeps({
        resolveReviewState: () =>
          Promise.resolve(
            makeReviewState({
              state: "reviewed",
              reviewedCommit: "head-sha-1",
            }),
          ),
        fetchSharedProviderThreads: () =>
          Promise.resolve({
            byProvider: new Map([
              [
                "coderabbit",
                [makeThread({ authorLogin: "coderabbitai", priority })],
              ],
            ]),
            headRefOid: "head-sha-1",
          }),
      }),
    );

    const p1Result = await activities.verifyAndCheckBlockingThreads({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      headSha: "head-sha-1",
      providerId: "coderabbit",
    });
    expect(p1Result).toEqual({
      active: true,
      passed: false,
      failureReason: "blocking-findings",
      description: "1 unresolved P0/P1 finding(s) from CodeRabbit",
    });

    priority = 2;
    const p2Result = await activities.verifyAndCheckBlockingThreads({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 42,
      headSha: "head-sha-1",
      providerId: "coderabbit",
    });
    expect(p2Result).toEqual({
      active: true,
      passed: true,
      failureReason: null,
      description: "CodeRabbit reviewed clean (no unresolved P0/P1 findings)",
    });
  });
});

describe("codeReviewActivities Temporal & commit-status effects", () => {
  it("signals coordinator, posts truncated ci/code-review status, and starts backfill workflows", async () => {
    const signalWithStart = vi.fn(() => Promise.resolve({}));
    const start = vi.fn(() => Promise.resolve({}));
    const createCommitStatus = vi.fn(() => Promise.resolve());
    const fakeClient: CodeReviewTemporalClient = {
      workflow: { signalWithStart, start },
    };

    const activities = createCodeReviewActivities(
      makeBaseDeps({
        getTemporalClient: () => Promise.resolve(fakeClient),
        createCommitStatus,
        listOpenMainPrs: () =>
          Promise.resolve([
            { prNumber: 101, headSha: "sha-101", baseRef: "main" },
          ]),
      }),
    );

    await activities.dispatchCoordinatorClaim({
      requestId: "req-1",
      replyWorkflowId: "pr-code-review-shepherdjerred-monorepo-101",
      replyRunId: "run-1",
      prNumber: 101,
      headSha: "sha-101",
      author: { login: "shepherdjerred", type: "User" },
      weights: { coderabbit: 3, codex: 1 },
      excludeProviders: [],
      nowMs: 1000,
    });
    expect(signalWithStart).toHaveBeenCalledWith(
      "codeReviewCoordinatorWorkflow",
      expect.objectContaining({
        workflowId: "code-review-coordinator",
        signal: "claimProvider",
      }),
    );

    await activities.reportCoordinatorOutcome({
      providerId: "coderabbit",
      outcome: "usage-limited",
      cooldownMs: 3_600_000,
      nowMs: 2000,
    });
    expect(signalWithStart).toHaveBeenCalledWith(
      "codeReviewCoordinatorWorkflow",
      expect.objectContaining({
        workflowId: "code-review-coordinator",
        signal: "reportProviderOutcome",
      }),
    );
    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'pr_code_review_provider_outcomes_total{provider="coderabbit",outcome="usage-limited",component="temporal-worker"} 1',
    );

    await activities.postCodeReviewCommitStatus({
      owner: "shepherdjerred",
      repo: "monorepo",
      sha: "sha-101",
      state: "success",
      description: "x".repeat(200),
      reason: "clean",
      durationSeconds: 12.5,
    });
    expect(createCommitStatus).toHaveBeenCalledWith(
      "ghs_install_token",
      expect.objectContaining({
        context: "ci/code-review",
        state: "success",
        description: "x".repeat(140),
      }),
    );

    const prs = await activities.listOpenMainPrsForCodeReview({
      owner: "shepherdjerred",
      repo: "monorepo",
    });
    expect(prs).toEqual([
      { prNumber: 101, headSha: "sha-101", baseRef: "main" },
    ]);

    await activities.startPrCodeReviewWorkflow({
      owner: "shepherdjerred",
      repo: "monorepo",
      prNumber: 101,
      headSha: "sha-101",
      baseRef: "main",
    });
    expect(start).toHaveBeenCalledWith(
      "prCodeReviewWorkflow",
      expect.objectContaining({
        workflowId: "pr-code-review/shepherdjerred/monorepo/101/sha-101",
      }),
    );
  });
});
