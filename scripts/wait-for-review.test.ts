import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TIMEOUT_SECONDS,
  resolveReviewGateProvider,
} from "./wait-for-review.ts";

describe("resolveReviewGateProvider", () => {
  test("pins the required CI gate to Qodo", () => {
    expect(resolveReviewGateProvider(undefined).id).toBe("qodo");
    expect(resolveReviewGateProvider("").id).toBe("qodo");
    expect(resolveReviewGateProvider("  QODO ").id).toBe("qodo");
  });

  test("rejects registered non-CI providers", () => {
    expect(() => resolveReviewGateProvider("codex")).toThrow(
      "CI review gate requires Qodo",
    );
    expect(() => resolveReviewGateProvider("greptile")).toThrow(
      "CI review gate requires Qodo",
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
export function reviewGateStepTimeoutSeconds(pipeline: string): number {
  const lines = pipeline.split("\n");
  const starts = lines.flatMap((line, index) =>
    line.startsWith("  - label:") ? [index] : [],
  );
  for (const [position, start] of starts.entries()) {
    const block = lines.slice(start, starts[position + 1] ?? lines.length);
    if (!block.some((line) => line.trim() === "key: review-gate")) {
      continue;
    }
    const declared = block.flatMap((line) => {
      const match = /^\s+timeout_in_minutes:\s*(\d+)\s*$/.exec(line);
      return match?.[1] === undefined ? [] : [Number.parseInt(match[1], 10)];
    });
    if (declared.length !== 1) {
      throw new Error(
        `review-gate declares ${declared.length.toString()} timeout_in_minutes, expected exactly 1`,
      );
    }
    return (declared[0] ?? 0) * 60;
  }
  throw new Error("pipeline.yml has no review-gate step");
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
      `${import.meta.dir}/../.buildkite/pipeline.yml`,
    ).text();
    expect(reviewGateStepTimeoutSeconds(pipeline)).toBeGreaterThanOrEqual(
      DEFAULT_TIMEOUT_SECONDS + PREAMBLE_MARGIN_SECONDS,
    );
  });

  test("reads review-gate's own timeout, not a later step's", () => {
    const withoutItsOwn = [
      '  - label: ":robot_face: Qodo review gate (required)"',
      "    key: review-gate",
      "    command: |",
      "      bun --no-install scripts/wait-for-review.ts",
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
    const slowestCompleted = 1834;
    expect(DEFAULT_TIMEOUT_SECONDS).toBeGreaterThan(slowestCompleted);
  });
});
