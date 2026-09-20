import { describe, expect, test } from "vitest";
import { parseMaxBlockingPriority } from "#commands/pr/review.ts";
import {
  CODEX_GATE_CONTEXT,
  harvestVerdict,
  pipelineNumberFromTargetUrl,
  nextPageUrl,
  REQUIRED_REVIEW_GATES,
  type GateStatus,
} from "#lib/review/harvest.ts";

/** Woodpecker restarts at pipeline granularity, so the retry unit is a number. */
const PIPELINE = "9633";
const failed: GateStatus = {
  state: "failure",
  targetUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${PIPELINE}`,
};

test("declares the required Codex gate context", () => {
  expect(CODEX_GATE_CONTEXT).toBe("ci/woodpecker/pr/codex-review-gate");
  expect(REQUIRED_REVIEW_GATES).toEqual([
    { providerId: "codex", context: CODEX_GATE_CONTEXT },
  ]);
});

test("rejects malformed blocking-priority configuration", () => {
  expect(() => parseMaxBlockingPriority("2foo")).toThrow(
    "REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3]",
  );
});

describe("pipelineNumberFromTargetUrl", () => {
  test("reads the pipeline number out of the status URL", () => {
    expect(pipelineNumberFromTargetUrl(failed.targetUrl)).toBe(PIPELINE);
    expect(
      pipelineNumberFromTargetUrl(
        `https://woodpecker.sjer.red/repos/1/pipeline/${PIPELINE}/2`,
      ),
    ).toBe(PIPELINE);
  });

  // Anything non-null here is reported as retryable and handed straight to
  // `woodpecker-cli pipeline start`, so the match has to be strict.
  test("returns null for a URL that names no pipeline", () => {
    expect(
      pipelineNumberFromTargetUrl("https://woodpecker.sjer.red/repos/1"),
    ).toBeNull();
    expect(
      pipelineNumberFromTargetUrl("https://woodpecker.sjer.red/pipeline/abc"),
    ).toBeNull();
    expect(pipelineNumberFromTargetUrl(null)).toBeNull();
  });
});

describe("harvestVerdict", () => {
  const stale = {
    gate: failed,
    reviewedAtHead: true,
    completionSignal: "issue-comment",
    blockingCount: 0,
  };

  test("retries a gate that expired before a clean review landed", () => {
    expect(harvestVerdict(stale)).toEqual({
      retryable: true,
      pipelineNumber: PIPELINE,
    });
  });

  test("leaves a gate that failed on real findings alone", () => {
    // This is the case a looser rule would re-run forever: the job fails
    // again, and a genuine finding starts to look like flakiness.
    const verdict = harvestVerdict({ ...stale, blockingCount: 2 });
    expect(verdict.retryable).toBe(false);
    expect(verdict).toMatchObject({ reason: "2 blocking finding(s) remain" });
  });

  test("waits when the review is for an older commit", () => {
    const verdict = harvestVerdict({ ...stale, reviewedAtHead: false });
    expect(verdict).toEqual({
      retryable: false,
      reason: "no review for this head yet",
    });
  });

  test("waits when the provider has not finished", () => {
    const verdict = harvestVerdict({ ...stale, completionSignal: "none" });
    expect(verdict).toEqual({
      retryable: false,
      reason: "provider has not finished reviewing",
    });
  });

  test("does nothing to a gate that is not failing", () => {
    for (const state of ["success", "pending", "error"]) {
      expect(harvestVerdict({ ...stale, gate: { ...failed, state } })).toEqual({
        retryable: false,
        reason: `gate is ${state}`,
      });
    }
  });

  test("does nothing when there is no gate at all", () => {
    expect(harvestVerdict({ ...stale, gate: null })).toEqual({
      retryable: false,
      reason: "no gate status",
    });
  });

  test("does not retry when the status names no pipeline", () => {
    const verdict = harvestVerdict({
      ...stale,
      gate: { state: "failure", targetUrl: null },
    });
    expect(verdict).toEqual({
      retryable: false,
      reason: "gate status names no CI pipeline",
    });
  });
});

describe("nextPageUrl", () => {
  test("follows the next link when the statuses span pages", () => {
    expect(
      nextPageUrl(
        '<https://api.github.com/repositories/1/commits/abc/status?page=2>; rel="next", ' +
          '<https://api.github.com/repositories/1/commits/abc/status?page=9>; rel="last"',
      ),
    ).toBe("https://api.github.com/repositories/1/commits/abc/status?page=2");
  });

  test("stops on the last page, which carries prev and first but no next", () => {
    expect(
      nextPageUrl(
        '<https://api.github.com/repositories/1/commits/abc/status?page=8>; rel="prev", ' +
          '<https://api.github.com/repositories/1/commits/abc/status?page=1>; rel="first"',
      ),
    ).toBeNull();
  });

  test("stops when the response carries no Link header at all", () => {
    expect(nextPageUrl(null)).toBeNull();
  });
});
