import { describe, expect, test } from "vitest";
import {
  blockingPolicyForThreshold,
  evaluateGate,
  evaluateMultiGate,
  firstReviewFindingCount,
  gateExitCode,
  isBlocking,
  REVIEW_GATE_BLOCKED_EXIT_CODE,
  REVIEW_GATE_FAILURE_EXIT_CODE,
  type LowSeverityPolicy,
  reviewGateSkipReasonForAuthor,
  type ProviderGateSnapshot,
} from "./gate.ts";
import { CODERABBIT_LOGIN } from "./providers/coderabbit.ts";
import { coderabbitProvider } from "./providers/coderabbit.ts";
import { codexProvider } from "./providers/codex.ts";
import { greptileProvider } from "./providers/greptile.ts";
import { qodoProvider } from "./providers/qodo.ts";
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
  test("skips a GitHub Bot author when the provider cannot review it", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: {
          login: "long-summer-intern[bot]",
          type: "Bot",
        },
        provider: qodoProvider,
      }),
    ).toBe("bot-author");
  });

  test("requires Codex review for a GitHub App-authored PR", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: {
          login: "justin-principal-engineer[bot]",
          type: "Bot",
        },
        provider: codexProvider,
      }),
    ).toBeNull();
  });

  test("skips other GitHub App-authored PRs for Codex", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        author: { login: "renovate[bot]", type: "Bot" },
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

  test("fails fast with quota remediation when the provider is blocked", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "errored",
      threads: [],
      blockedReason: "usage-limited",
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("blocked (usage-limited)");
    expect(d.message).toContain("abc123");
    // The operator's next action is adding credits, not re-triggering.
    expect(d.message).toContain("credits");
    expect(d.message).not.toContain("Re-trigger");
  });

  test("a usage-limit block exits with the soft-fail quota status", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "errored",
      threads: [],
      blockedReason: "usage-limited",
    });
    expect(gateExitCode(d)).toBe(REVIEW_GATE_BLOCKED_EXIT_CODE);
    expect(REVIEW_GATE_BLOCKED_EXIT_CODE).toBe(42);
  });

  test("findings, generic errors, and undeclared blocks exit with the hard failure status", () => {
    const findings = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [thread({ priority: 0 })],
    });
    const errored = evaluateGate({
      ...base,
      reviewState: "errored",
      threads: [],
    });
    const undeclared = evaluateGate({
      ...base,
      reviewState: "errored",
      threads: [],
      blockedReason: "something-else",
    });
    for (const d of [findings, errored, undeclared]) {
      expect(d.state).toBe("failed");
      expect(gateExitCode(d)).toBe(REVIEW_GATE_FAILURE_EXIT_CODE);
    }
    expect(REVIEW_GATE_FAILURE_EXIT_CODE).not.toBe(
      REVIEW_GATE_BLOCKED_EXIT_CODE,
    );
  });

  test("a passing decision exits zero and a waiting one has no exit status", () => {
    const passed = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [],
    });
    expect(gateExitCode(passed)).toBe(0);
    const waiting = evaluateGate({
      ...base,
      reviewState: "reviewing",
      threads: [],
    });
    expect(() => gateExitCode(waiting)).toThrow("no exit status");
  });

  test("keeps the generic errored message for an undeclared block reason", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "errored",
      threads: [],
      blockedReason: "something-else",
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("did not complete successfully");
    expect(d.message).toContain("something-else");
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

function snapshot(
  overrides: Partial<ProviderGateSnapshot> & {
    provider: ProviderGateSnapshot["provider"];
  },
): ProviderGateSnapshot {
  return {
    reviewState: "reviewed",
    threads: [],
    ...overrides,
  };
}

describe("evaluateMultiGate", () => {
  const head = "abc123";

  test("one clean review passes while others are still reviewing", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({ provider: codexProvider }),
        snapshot({ provider: coderabbitProvider, reviewState: "reviewing" }),
      ],
    });
    expect(d.state).toBe("passed");
    expect(d.message).toContain("Codex");
  });

  test("an unresolved P0 vetoes an otherwise passing gate", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({ provider: codexProvider }),
        snapshot({
          provider: coderabbitProvider,
          threads: [thread({ authorLogin: CODERABBIT_LOGIN, priority: 0 })],
        }),
      ],
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("veto");
    expect(d.message).toContain("CodeRabbit");
    expect(gateExitCode(d)).toBe(REVIEW_GATE_FAILURE_EXIT_CODE);
  });

  test("a P0 veto fails fast while another provider is still reviewing", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({
          provider: codexProvider,
          reviewState: "reviewing",
          threads: [thread({ priority: 0 })],
        }),
        snapshot({ provider: coderabbitProvider, reviewState: "reviewing" }),
      ],
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("veto");
  });

  test("a P1 from another provider does not veto a pass", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({ provider: codexProvider }),
        snapshot({
          provider: coderabbitProvider,
          reviewState: "reviewed",
          // A P1 always blocks its own provider — but with Codex passed and
          // no P0 standing anywhere, the gate still passes.
          threads: [
            thread({
              authorLogin: CODERABBIT_LOGIN,
              priority: 1,
              raisedInReview: { ordinal: 2, hadBlockingSeverity: false },
            }),
          ],
        }),
      ],
    });
    expect(d.state).toBe("passed");
  });

  test("resolved, outdated, or foreign P0 lookalikes do not veto", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({ provider: codexProvider }),
        snapshot({
          provider: coderabbitProvider,
          threads: [
            thread({
              authorLogin: CODERABBIT_LOGIN,
              priority: 0,
              isResolved: true,
            }),
            thread({
              authorLogin: CODERABBIT_LOGIN,
              priority: 0,
              isOutdated: true,
            }),
            thread({ authorLogin: "shepherdjerred", priority: 0 }),
          ],
        }),
      ],
    });
    expect(d.state).toBe("passed");
  });

  test("waits while any provider is still reviewing", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({
          provider: codexProvider,
          reviewState: "reviewing",
          threads: [thread({ priority: 2 })],
        }),
        snapshot({ provider: coderabbitProvider, reviewState: "reviewing" }),
      ],
    });
    expect(d.state).toBe("waiting");
    expect(d.message).toContain("Codex");
    expect(d.message).toContain("CodeRabbit");
  });

  test("unanimous blocks stay on the soft-fail path", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({
          provider: codexProvider,
          reviewState: "errored",
          blockedReason: "usage-limited",
        }),
        snapshot({
          provider: coderabbitProvider,
          reviewState: "errored",
          blockedReason: "usage-limited",
        }),
      ],
    });
    expect(d.state).toBe("failed");
    if (d.state !== "failed") throw new Error("unreachable");
    expect(d.blockedReason).toBe("usage-limited");
    expect(gateExitCode(d)).toBe(REVIEW_GATE_BLOCKED_EXIT_CODE);
  });

  test("a findings failure among blocks fails hard and names the ignored", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({
          provider: codexProvider,
          reviewState: "reviewed",
          // P1, not P0: a P0 would take the veto branch instead of this one.
          threads: [thread({ priority: 1 })],
        }),
        snapshot({
          provider: coderabbitProvider,
          reviewState: "errored",
          blockedReason: "usage-limited",
        }),
      ],
    });
    expect(d.state).toBe("failed");
    expect(gateExitCode(d)).toBe(REVIEW_GATE_FAILURE_EXIT_CODE);
    expect(d.message).toContain("Ignored blocked provider(s): CodeRabbit");
  });

  test("unanimous skips pass", () => {
    const d = evaluateMultiGate({
      head,
      policy: policy(),
      providers: [
        snapshot({
          provider: qodoProvider,
          skipReason: "bot-author",
        }),
        snapshot({
          provider: greptileProvider,
          skipReason: "no-reviewable-files",
        }),
      ],
    });
    expect(d.state).toBe("passed");
  });

  test("throws loudly with no provider snapshots", () => {
    expect(() =>
      evaluateMultiGate({ head, policy: policy(), providers: [] }),
    ).toThrow(/at least one provider/);
  });
});
