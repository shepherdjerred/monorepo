import { describe, expect, test } from "vitest";
import {
  findGeneratedStep,
  readGeneratedSteps,
} from "../lib/ci/generated-steps.ts";
import {
  DEFAULT_REQUEST_GRACE_SECONDS,
  DEFAULT_REQUEST_RETRY_SECONDS,
  requestGraceSecondsForProvider,
  reviewRequestScheduleBounds,
  SLOWEST_COMPLETED_REVIEW_SECONDS,
  validateReviewRequestSchedule,
} from "../lib/review/review-gate-policy.ts";
import {
  DEFAULT_TIMEOUT_SECONDS,
  parseMaxBlockingPriority,
  resolveReviewGateProvider,
  resolveReviewGateProviders,
} from "./wait-for-review.ts";
import {
  confirmPass,
  PASS_CONFIRMATION_TICKS,
  verifyPassBeforeAccepting,
} from "../lib/review/review-gate-poll.ts";
import {
  type BlockingPolicy,
  codexProvider,
  qodoProvider,
  REVIEW_GATE_BLOCKED_EXIT_CODE,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import type { ReviewStateResult } from "@shepherdjerred/code-review/github";
import type { ProviderObservation } from "../lib/review/review-gate-observe.ts";

describe("resolveReviewGateProvider", () => {
  test("defaults direct invocations to Codex", () => {
    expect(resolveReviewGateProvider(undefined).id).toBe("codex");
    expect(resolveReviewGateProvider("").id).toBe("codex");
    expect(resolveReviewGateProvider("  CODEX ").id).toBe("codex");
  });

  test("accepts the required CI provider", () => {
    expect(resolveReviewGateProvider("codex").id).toBe("codex");
    expect(resolveReviewGateProvider("  CODEX ").id).toBe("codex");
  });

  test("rejects optional and unknown providers at the CI boundary", () => {
    expect(() => resolveReviewGateProvider("qodo")).toThrow(
      "CI review gate requires Codex",
    );
    expect(() => resolveReviewGateProvider("greptile")).toThrow(
      "CI review gate requires Codex",
    );
    expect(() => resolveReviewGateProvider("unknown")).toThrow(
      "CI review gate requires Codex",
    );
  });
});

function withReviewEnv(
  providers: string | undefined,
  provider: string | undefined,
  fn: () => void,
): void {
  const savedProviders = Bun.env["REVIEW_PROVIDERS"];
  const savedProvider = Bun.env["REVIEW_PROVIDER"];
  if (providers === undefined) delete Bun.env["REVIEW_PROVIDERS"];
  else Bun.env["REVIEW_PROVIDERS"] = providers;
  if (provider === undefined) delete Bun.env["REVIEW_PROVIDER"];
  else Bun.env["REVIEW_PROVIDER"] = provider;
  try {
    fn();
  } finally {
    if (savedProviders === undefined) delete Bun.env["REVIEW_PROVIDERS"];
    else Bun.env["REVIEW_PROVIDERS"] = savedProviders;
    if (savedProvider === undefined) delete Bun.env["REVIEW_PROVIDER"];
    else Bun.env["REVIEW_PROVIDER"] = savedProvider;
  }
}

function gateProviderIds(): string[] {
  return resolveReviewGateProviders().map((provider) => provider.id);
}

describe("resolveReviewGateProviders", () => {
  test("defaults to the required provider with no configuration", () => {
    withReviewEnv(undefined, undefined, () => {
      expect(gateProviderIds()).toEqual(["codex"]);
    });
  });

  test("keeps the legacy singular contract", () => {
    withReviewEnv(undefined, "codex", () => {
      expect(gateProviderIds()).toEqual(["codex"]);
    });
    withReviewEnv(undefined, "qodo", () => {
      expect(() => gateProviderIds()).toThrow("CI review gate requires Codex");
    });
  });

  test("accepts a comma list with normalization and dedupe", () => {
    withReviewEnv(" codex , Qodo,coderabbit,codex,", undefined, () => {
      expect(gateProviderIds()).toEqual(["codex", "qodo", "coderabbit"]);
    });
  });

  test("fails loudly on unknown or empty provider lists", () => {
    withReviewEnv("codex,unknown", undefined, () => {
      expect(() => gateProviderIds()).toThrow("Unknown review provider");
    });
    withReviewEnv(" , ", undefined, () => {
      expect(() => gateProviderIds()).toThrow("at least one provider");
    });
  });
});

describe("parseMaxBlockingPriority", () => {
  test("accepts the configured severity range and defaults to P3", () => {
    expect(parseMaxBlockingPriority(undefined)).toBe(3);
    expect(parseMaxBlockingPriority(" 2 ")).toBe(2);
    expect(parseMaxBlockingPriority("0")).toBe(0);
  });

  test("rejects malformed priorities instead of accepting a prefix", () => {
    expect(() => parseMaxBlockingPriority("2foo")).toThrow(
      "REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3]",
    );
    expect(() => parseMaxBlockingPriority("4")).toThrow(
      "REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3]",
    );
  });
});

/**
 * The step's own timeout, read from its block alone.
 *
 * Slicing to end-of-file and taking the first match would find a *later*
 * step's timeout whenever review-gate loses its own, which is exactly the
 * regression this budget test exists to catch — the assertion would keep
 * passing against an unrelated number.
 */
function reviewGateStepBlock(pipeline: string, stepKey: string): string[] {
  const lines = pipeline.split("\n");
  const starts = lines.flatMap((line, index) =>
    line.startsWith("  - label:") ? [index] : [],
  );
  for (const [position, start] of starts.entries()) {
    const block = lines.slice(start, starts[position + 1] ?? lines.length);
    if (block.some((line) => line.trim() === `key: ${stepKey}`)) return block;
  }
  throw new Error(`pipeline.yml has no ${stepKey} step`);
}

export function reviewGateStepTimeoutSeconds(
  pipeline: string,
  stepKey = "review-gate",
): number {
  const block = reviewGateStepBlock(pipeline, stepKey);
  const declared = block.flatMap((line) => {
    const match = /^\s+timeout_in_minutes:\s*(\d+)\s*$/.exec(line);
    return match?.[1] === undefined ? [] : [Number.parseInt(match[1], 10)];
  });
  if (declared.length !== 1) {
    throw new Error(
      `${stepKey} declares ${declared.length.toString()} timeout_in_minutes, expected exactly 1`,
    );
  }
  return (declared[0] ?? 0) * 60;
}

/** A review-gate step's command block, as its lines. */
export function reviewGateStepCommand(
  pipeline: string,
  stepKey = "review-gate",
): string[] {
  const block = reviewGateStepBlock(pipeline, stepKey);
  const commandAt = block.findIndex((line) => line.trim() === "command: |");
  if (commandAt === -1) throw new Error(`${stepKey} declares no command`);
  const body: string[] = [];
  for (const line of block.slice(commandAt + 1)) {
    if (line.trim() !== "" && !line.startsWith("      ")) break;
    body.push(line.trim());
  }
  return body.filter((line) => line !== "");
}

export function reviewGateStepBlockText(
  pipeline: string,
  stepKey: string,
): string {
  return reviewGateStepBlock(pipeline, stepKey).join("\n");
}

/**
 * How long the step spends on `toolchain.sh` and the filtered install before
 * wait-for-review.ts starts counting. Nothing bounds that preamble — a cold or
 * stale image pays for mise bootstrap and network downloads — so the margin is
 * deliberately generous. Getting it wrong reinstates the anonymous step-timeout
 * kill this whole change exists to prevent.
 */
const PREAMBLE_MARGIN_SECONDS = 20 * 60;

// Two timeouts govern this gate and only one of them explains itself. If the
// STEP's is the smaller, the job dies with an anonymous step timeout and the
// operator cannot tell a slow provider from a broken one, so the ordering is
// part of the gate's contract rather than a coincidence of two constants.
describe("review gate timeout budget", () => {
  test("expires before the CI step that runs it", async () => {
    const steps = await readGeneratedSteps(
      new URL("../..", import.meta.url).pathname,
    );
    const gate = findGeneratedStep(steps, "codex-review-gate");
    expect(gate).toBeDefined();
    expect((gate?.timeoutMinutes ?? 0) * 60).toBeGreaterThanOrEqual(
      DEFAULT_TIMEOUT_SECONDS + PREAMBLE_MARGIN_SECONDS,
    );
  });

  test("reads review-gate's own timeout, not a later step's", () => {
    const withoutItsOwn = [
      '  - label: ":robot_face: Qodo review gate (required)"',
      "    key: review-gate",
      "    command: |",
      "      bun --no-install scripts/review/wait-for-review.ts",
      '  - label: ":microscope: pr dry-run"',
      "    key: pr-dryrun",
      "    timeout_in_minutes: 30",
      "",
    ].join("\n");
    expect(() => reviewGateStepTimeoutSeconds(withoutItsOwn)).toThrow(
      "review-gate declares 0 timeout_in_minutes",
    );

    const withItsOwn = withoutItsOwn.replace(
      "    key: review-gate\n",
      "    key: review-gate\n    timeout_in_minutes: 60\n",
    );
    expect(reviewGateStepTimeoutSeconds(withItsOwn)).toBe(60 * 60);
  });

  // A floor, not a sufficiency proof. A 2400s budget expired on a ~51-line PR
  // whose review was still running, so no constant here can promise every
  // review finishes inside the build. What this does guarantee is that the
  // budget never regresses below a latency we have actually watched a review
  // survive, which is the mistake the 1200s default made.
  test("does not regress below the slowest completed review", () => {
    // Both measured on PR #2152, on reviews that completed normally only after
    // the 1200s budget had already failed the gate.
    expect(DEFAULT_TIMEOUT_SECONDS).toBeGreaterThan(
      SLOWEST_COMPLETED_REVIEW_SECONDS,
    );
  });

  // The retry is only a retry if the gate is still alive to see its answer. A
  // grace period and a retry interval tuned in isolation produced exactly that
  // bug: the second request landed 31 minutes in, against a 40-minute deadline,
  // leaving nine minutes for a review that routinely needs thirty.
  test("leaves the slowest completed review time to finish after the last request", () => {
    const bounds = reviewRequestScheduleBounds({
      graceSeconds: DEFAULT_REQUEST_GRACE_SECONDS,
      retryAfterSeconds: DEFAULT_REQUEST_RETRY_SECONDS,
    });
    expect(DEFAULT_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(
      bounds.minimumGateTimeoutSeconds,
    );
  });

  test("applies the first-review grace only to push-triggered providers", () => {
    // Qodo starts on every push via `.pr_agent.toml`; Codex only starts when the
    // pull request opens, so a new head needs an immediate explicit request.
    expect(DEFAULT_REQUEST_GRACE_SECONDS).toBeGreaterThan(0);
    expect(
      requestGraceSecondsForProvider(
        qodoProvider,
        DEFAULT_REQUEST_GRACE_SECONDS,
      ),
    ).toBe(DEFAULT_REQUEST_GRACE_SECONDS);
    expect(
      requestGraceSecondsForProvider(
        codexProvider,
        DEFAULT_REQUEST_GRACE_SECONDS,
      ),
    ).toBe(0);
    expect(
      reviewRequestScheduleBounds({
        graceSeconds: DEFAULT_REQUEST_GRACE_SECONDS,
        retryAfterSeconds: DEFAULT_REQUEST_RETRY_SECONDS,
      }).lastRequestAtSeconds,
    ).toBe(DEFAULT_REQUEST_GRACE_SECONDS + DEFAULT_REQUEST_RETRY_SECONDS);
  });

  test("rejects timing overrides that cut off the retry budget", () => {
    expect(() =>
      validateReviewRequestSchedule({
        graceSeconds: 600,
        retryAfterSeconds: 3000,
        timeoutSeconds: 3600,
      }),
    ).toThrow("requires at least 5434s");
    expect(() =>
      validateReviewRequestSchedule({
        graceSeconds: 0,
        retryAfterSeconds: DEFAULT_REQUEST_RETRY_SECONDS,
        timeoutSeconds:
          DEFAULT_REQUEST_RETRY_SECONDS + SLOWEST_COMPLETED_REVIEW_SECONDS,
      }),
    ).not.toThrow();
  });
});

// The gate reads only GitHub state, never the PR's diff, so running it from the
// PR's checkout buys nothing and costs correctness: `code-review` is a
// workspace dependency, so the branch supplied its own grader. PR #1389 read 0
// blocking findings against current main and 3 against its own 22-commit-stale
// parser, and no change to that PR could have cleared it.
describe("review gate source", () => {
  test("the required Codex gate uses the main-sourced wrapper", async () => {
    const steps = await readGeneratedSteps(
      new URL("../..", import.meta.url).pathname,
    );
    const gate = findGeneratedStep(steps, "codex-review-gate");
    expect(gate).toBeDefined();
    const commands = gate?.commands ?? [];
    // The wrapper is what pins the gate to main's copy of the script; calling
    // wait-for-review.ts directly would run the PR's own version of the gate
    // that is supposed to be judging it.
    expect(commands).not.toContain(
      "bun --no-install scripts/review/wait-for-review.ts",
    );
    expect(commands.some((line) => line.includes("review-gate.sh"))).toBe(true);
  });

  /**
   * Buildkite needed an explicit `cancel_on_build_failing: false` to stop a
   * failing sibling step from killing the gate mid-review. Woodpecker runs
   * each workflow independently, so the property now follows from the gate
   * depending on nothing: no other lane's failure can reach it.
   */
  test("the required gate cannot be cancelled by another lane failing", async () => {
    const steps = await readGeneratedSteps(
      new URL("../..", import.meta.url).pathname,
    );
    const gate = findGeneratedStep(steps, "codex-review-gate");
    expect(gate).toBeDefined();
    expect(gate?.dependsOn ?? []).toEqual([]);
  });

  test("the gate script checks out a ref and runs the gate from it", async () => {
    const script = await Bun.file(
      `${import.meta.dir}/../../ci/scripts/review-gate.sh`,
    ).text();
    expect(script).toContain("git worktree add");
    expect(script).toContain("REVIEW_GATE_REF:-main");
    expect(script).toContain("scripts/review/wait-for-review.ts");
    // The commit actually used has to reach the signal event, or a count still
    // cannot be attributed to the parser that produced it.
    expect(script).toContain("REVIEW_GATE_PARSER_COMMIT");
    // Only the blocked-by-quota status passes, with a warning; Woodpecker has
    // no per-status soft-fail, so the script is the only place it can live.
    expect(script).toContain(
      `QUOTA_EXIT_STATUS=${String(REVIEW_GATE_BLOCKED_EXIT_CODE)}`,
    );
    const quotaBranch = script.slice(
      script.indexOf('if [[ "$GATE_STATUS" -eq "$QUOTA_EXIT_STATUS" ]]; then'),
    );
    expect(quotaBranch).toMatch(
      /out of quota[\s\S]*exit 0\nfi\nexit "\$GATE_STATUS"/u,
    );
  });
});

describe("confirmPass", () => {
  test("accepts a pass only on consecutive passing ticks", () => {
    expect(PASS_CONFIRMATION_TICKS).toBe(2);
    const first = confirmPass(true, 0);
    expect(first).toEqual({ streak: 1, accepted: false });
    expect(confirmPass(true, first.streak)).toEqual({
      streak: 2,
      accepted: true,
    });
  });

  test("a waiting tick resets the streak", () => {
    const first = confirmPass(true, 0);
    const reset = confirmPass(false, first.streak);
    expect(reset).toEqual({ streak: 0, accepted: false });
    expect(confirmPass(true, reset.streak).accepted).toBe(false);
  });
});

describe("verifyPassBeforeAccepting", () => {
  const policy: BlockingPolicy = {
    alwaysBlockingPriority: 1,
    maxBlockingPriority: 3,
    lowSeverity: "first-review-or-accompanied",
  };
  const config = {
    repo: "shepherdjerred/monorepo",
    number: 3189,
    head: "abc123",
    token: "token",
    policy,
  };
  const reviewed: ReviewStateResult = {
    state: "reviewed",
    completionSignal: "review-at-head",
    reviewedCommit: "abc123",
    reviewedAt: "2026-09-27T04:00:00Z",
    staleReaction: false,
    skipReason: null,
    blockedReason: null,
  };
  function observed(): ProviderObservation[] {
    return [
      {
        provider: codexProvider,
        skipped: false,
        skipReason: null,
        state: reviewed,
        threads: [],
        headRefOid: "abc123",
        headPushedAt: null,
        nextAttempt: 1,
        decision: null,
      },
    ];
  }

  test("accepts when the re-fetch is still clean", async () => {
    await expect(
      verifyPassBeforeAccepting({
        ...config,
        observed: observed(),
        fetchThreads: async () => [],
      }),
    ).resolves.toBe(true);
  });

  test("a P0 posted after the tick's fetch fails fast", async () => {
    const veto: ReviewThread = {
      authorLogin: "chatgpt-codex-connector",
      isResolved: false,
      isOutdated: false,
      path: "src/example.ts",
      line: 1,
      url: null,
      priority: 0,
      title: "Critical finding.",
      threadId: "thread-1",
      commentId: null,
      raisedInReview: null,
    };
    await expect(
      verifyPassBeforeAccepting({
        ...config,
        observed: observed(),
        fetchThreads: async () => [veto],
      }),
    ).rejects.toThrow(/veto the gate/);
  });

  test("fails closed with nothing to re-check", async () => {
    await expect(
      verifyPassBeforeAccepting({
        ...config,
        observed: [],
        fetchThreads: async () => [],
      }),
    ).resolves.toBe(false);
  });
});
