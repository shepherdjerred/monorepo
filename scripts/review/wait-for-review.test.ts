import { describe, expect, test } from "vitest";
import {
  DEFAULT_REQUEST_GRACE_SECONDS,
  DEFAULT_REQUEST_RETRY_SECONDS,
  requestGraceSecondsForProvider,
  reviewRequestScheduleBounds,
  SLOWEST_COMPLETED_REVIEW_SECONDS,
  validateReviewRequestSchedule,
} from "../lib/review-gate-policy.ts";
import {
  DEFAULT_TIMEOUT_SECONDS,
  parseMaxBlockingPriority,
  resolveReviewGateProvider,
} from "./wait-for-review.ts";
import { codexProvider, qodoProvider } from "@shepherdjerred/code-review";

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
 * deliberately generous. Getting it wrong reinstates the anonymous Buildkite
 * kill this whole change exists to prevent.
 */
const PREAMBLE_MARGIN_SECONDS = 20 * 60;

// Two timeouts govern this gate and only one of them explains itself. If
// Buildkite's is the smaller, the job dies with an anonymous step timeout and
// the operator cannot tell a slow provider from a broken one, so the ordering
// is part of the gate's contract rather than a coincidence of two constants.
describe("review gate timeout budget", () => {
  test("expires before the Buildkite step that runs it", async () => {
    // Resolved from this file: the suite runs with scripts/ as the cwd.
    const pipeline = await Bun.file(
      `${import.meta.dir}/../../.buildkite/pipeline.yml`,
    ).text();
    for (const stepKey of ["codex-review-gate"]) {
      expect(
        reviewGateStepTimeoutSeconds(pipeline, stepKey),
      ).toBeGreaterThanOrEqual(
        DEFAULT_TIMEOUT_SECONDS + PREAMBLE_MARGIN_SECONDS,
      );
    }
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
    const pipeline = await Bun.file(
      `${import.meta.dir}/../../.buildkite/pipeline.yml`,
    ).text();
    for (const [stepKey, provider] of [
      ["codex-review-gate", "codex"],
    ] as const) {
      const command = reviewGateStepCommand(pipeline, stepKey);
      expect(command).not.toContain(
        "bun --no-install scripts/review/wait-for-review.ts",
      );
      expect(command.some((line) => line.includes("review-gate.sh"))).toBe(
        true,
      );
      expect(reviewGateStepBlockText(pipeline, stepKey)).toContain(
        `REVIEW_PROVIDER: ${provider}`,
      );
    }
  });

  test("the required gate remains retryable", async () => {
    const pipeline = await Bun.file(
      `${import.meta.dir}/../../.buildkite/pipeline.yml`,
    ).text();
    for (const stepKey of ["codex-review-gate"]) {
      expect(reviewGateStepBlockText(pipeline, stepKey)).not.toContain(
        "cancel_on_build_failing",
      );
    }
  });

  test("the gate script checks out a ref and runs the gate from it", async () => {
    const script = await Bun.file(
      `${import.meta.dir}/../../.buildkite/scripts/review-gate.sh`,
    ).text();
    expect(script).toContain("git worktree add");
    expect(script).toContain("REVIEW_GATE_REF:-main");
    expect(script).toContain("scripts/review/wait-for-review.ts");
    // The commit actually used has to reach the signal event, or a count still
    // cannot be attributed to the parser that produced it.
    expect(script).toContain("REVIEW_GATE_PARSER_COMMIT");
  });
});
