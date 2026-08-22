import { describe, expect, test } from "vitest";
import {
  blockingPolicyForThreshold,
  evaluateGate,
  firstReviewFindingCount,
  isBlocking,
  type LowSeverityPolicy,
  reviewGateSkipReasonForAuthor,
} from "./gate.ts";
import { codexProvider } from "./providers/codex.ts";
import { greptileProvider } from "./providers/greptile.ts";
import type { ReviewThread } from "./types.ts";

function thread(overrides: Partial<ReviewThread>): ReviewThread {
  return {
    authorLogin: "chatgpt-codex-connector",
    isResolved: false,
    isOutdated: false,
    path: "src/x.ts",
    line: 10,
    url: "https://github.com/o/r/pull/1#d",
    priority: 2,
    title: null,
    threadId: null,
    commentId: null,
    // Unattributed by default, which the policy treats as blocking. The
    // attribution-sensitive cases set this explicitly.
    raisedInReview: null,
    ...overrides,
  };
}

function policy(
  maxBlockingPriority = 3,
  lowSeverity: LowSeverityPolicy = "first-review-or-accompanied",
) {
  return blockingPolicyForThreshold(maxBlockingPriority, lowSeverity);
}

describe("reviewGateSkipReasonForAuthor", () => {
  test("skips a GitHub Bot author when Codex cannot review it", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: {
          login: "long-summer-intern[bot]",
          type: "Bot",
        },
        provider: codexProvider,
      }),
    ).toBe("bot-author");
  });

  test("does not skip the same GitHub Bot author when Greptile can review it", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: {
          login: "long-summer-intern[bot]",
          type: "Bot",
        },
        provider: greptileProvider,
      }),
    ).toBeNull();
  });

  test("does not skip a human author for Codex", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: {
          login: "shepherdjerred",
          type: "User",
        },
        provider: codexProvider,
      }),
    ).toBeNull();
  });

  test("fails closed for a new GitHub account type", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: {
          login: "future-service",
          type: "ServiceAccount",
        },
        provider: codexProvider,
      }),
    ).toBeNull();
  });

  test("does not infer bot status from the login", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: {
          login: "lookalike[bot]",
          type: "User",
        },
        provider: codexProvider,
      }),
    ).toBeNull();
  });
});

describe("isBlocking", () => {
  test("blocks an unresolved, non-outdated provider thread within threshold", () => {
    expect(isBlocking(thread({}), codexProvider, policy())).toBe(true);
  });
  test("does not block a resolved thread", () => {
    expect(
      isBlocking(thread({ isResolved: true }), codexProvider, policy()),
    ).toBe(false);
  });
  test("does not block an outdated thread", () => {
    expect(
      isBlocking(thread({ isOutdated: true }), codexProvider, policy()),
    ).toBe(false);
  });
  test("does not block a thread from another author", () => {
    expect(
      isBlocking(
        thread({ authorLogin: "some-human" }),
        codexProvider,
        policy(),
      ),
    ).toBe(false);
  });
  test("does not block a thread below the priority threshold", () => {
    expect(isBlocking(thread({ priority: 3 }), codexProvider, policy(2))).toBe(
      false,
    );
  });
  test("does not block a thread with no severity badge", () => {
    expect(
      isBlocking(thread({ priority: null }), codexProvider, policy()),
    ).toBe(false);
  });
  test("matches the REST [bot] login form", () => {
    expect(
      isBlocking(
        thread({ authorLogin: "chatgpt-codex-connector[bot]" }),
        codexProvider,
        policy(),
      ),
    ).toBe(true);
  });
});

describe("isBlocking — low-severity policy", () => {
  const p1 = { ordinal: 1, hadBlockingSeverity: false };
  test("an always-blocking finding blocks whenever it was raised", () => {
    expect(
      isBlocking(
        thread({
          priority: 1,
          raisedInReview: { ordinal: 9, hadBlockingSeverity: true },
        }),
        codexProvider,
        policy(),
      ),
    ).toBe(true);
  });

  test("a low-severity finding from the first review blocks", () => {
    expect(
      isBlocking(
        thread({ priority: 2, raisedInReview: p1 }),
        codexProvider,
        policy(),
      ),
    ).toBe(true);
  });

  test("a later-review low-severity finding alone does not block", () => {
    expect(
      isBlocking(
        thread({
          priority: 2,
          raisedInReview: { ordinal: 4, hadBlockingSeverity: false },
        }),
        codexProvider,
        policy(),
      ),
    ).toBe(false);
  });

  test("a later-review low-severity finding blocks when its review also carried a blocking one", () => {
    expect(
      isBlocking(
        thread({
          priority: 2,
          raisedInReview: { ordinal: 4, hadBlockingSeverity: true },
        }),
        codexProvider,
        policy(),
      ),
    ).toBe(true);
  });

  test("an unattributable low-severity finding blocks", () => {
    expect(
      isBlocking(
        thread({ priority: 2, raisedInReview: null }),
        codexProvider,
        policy(),
      ),
    ).toBe(true);
  });

  test('the "always" policy ignores attribution entirely', () => {
    expect(
      isBlocking(
        thread({
          priority: 2,
          raisedInReview: { ordinal: 9, hadBlockingSeverity: false },
        }),
        codexProvider,
        policy(3, "always"),
      ),
    ).toBe(true);
  });

  test("lowering the threshold to the always-blocking severity disables the low-severity rules", () => {
    expect(
      isBlocking(
        thread({ priority: 2, raisedInReview: p1 }),
        codexProvider,
        policy(1),
      ),
    ).toBe(false);
  });
});

describe("firstReviewFindingCount", () => {
  test("counts only the provider's first-review findings", () => {
    const threads = [
      thread({ raisedInReview: { ordinal: 1, hadBlockingSeverity: false } }),
      thread({ raisedInReview: { ordinal: 1, hadBlockingSeverity: false } }),
      thread({ raisedInReview: { ordinal: 2, hadBlockingSeverity: false } }),
      thread({
        authorLogin: "some-human",
        raisedInReview: { ordinal: 1, hadBlockingSeverity: false },
      }),
    ];
    expect(firstReviewFindingCount(threads, codexProvider)).toBe(2);
  });

  test("is null when nothing is attributed to a first review", () => {
    expect(firstReviewFindingCount([thread({})], codexProvider)).toBeNull();
  });
});

describe("evaluateGate", () => {
  const base = {
    head: "abc123",
    provider: codexProvider,
    policy: policy(),
  };

  test("waits while reviewing", () => {
    const d = evaluateGate({ ...base, reviewState: "reviewing", threads: [] });
    expect(d.state).toBe("waiting");
  });

  test("fails when errored", () => {
    const d = evaluateGate({ ...base, reviewState: "errored", threads: [] });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("Codex");
  });

  test("passes when reviewed with no blocking threads", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [thread({ isResolved: true })],
    });
    expect(d.state).toBe("passed");
  });

  test("fails when reviewed with a blocking thread", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [thread({})],
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("1 unresolved Codex comment");
    expect(d.message).toContain("P2");
  });

  test("names the finding when the thread carries a title", () => {
    // Comment-parsed findings carry a title; listing only the path forces the
    // operator to open GitHub to learn what is blocking.
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [thread({ title: "S3 fetch lacks timeout" })],
    });
    expect(d.message).toContain("S3 fetch lacks timeout");
    expect(d.message).toContain("src/x.ts:10");
  });

  test("omits the title separator for a thread without one", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [thread({})],
    });
    expect(d.message).toContain("P2 src/x.ts:10");
  });

  // The degeneration the raising-review binding exists to prevent. A threshold
  // bound to the CURRENT round would stop blocking on the first review's
  // low-severity findings as soon as a second review existed, so pushing
  // anything at all would clear the sweep without fixing it.
  test("a first-review low-severity finding still blocks after later reviews arrive", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [
        thread({
          priority: 2,
          title: "unfixed from the first review",
          raisedInReview: { ordinal: 1, hadBlockingSeverity: false },
        }),
        thread({
          priority: 2,
          title: "raised later, advisory",
          raisedInReview: { ordinal: 5, hadBlockingSeverity: false },
        }),
      ],
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("1 unresolved Codex comment");
    expect(d.message).toContain("unfixed from the first review");
    expect(d.message).not.toContain("raised later, advisory");
  });

  test("passes once only later-review low-severity findings remain", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [
        thread({
          priority: 2,
          raisedInReview: { ordinal: 5, hadBlockingSeverity: false },
        }),
      ],
    });
    expect(d.state).toBe("passed");
  });

  test("explains why a ride-along low-severity finding is blocking", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [
        thread({
          priority: 1,
          title: "the blocking one",
          raisedInReview: { ordinal: 5, hadBlockingSeverity: true },
        }),
        thread({
          priority: 2,
          title: "rides along",
          raisedInReview: { ordinal: 5, hadBlockingSeverity: true },
        }),
      ],
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("2 unresolved Codex comment");
    expect(d.message).toContain("rides along");
    expect(d.message).toContain("round you are already paying for");
  });

  test("passes on a skip with the reason in the message", () => {
    const d = evaluateGate({
      ...base,
      provider: greptileProvider,
      reviewState: "reviewed",
      threads: [],
      skipReason: "no-reviewable-files",
    });
    expect(d.state).toBe("passed");
    expect(d.message).toContain("no-reviewable-files");
    expect(d.message).toContain("Greptile");
  });
});
