import { describe, expect, test } from "vitest";
import { parseMaxBlockingPriority } from "#commands/pr/review.ts";
import {
  CODEX_GATE_CONTEXT,
  GATE_CONTEXT,
  harvestVerdict,
  jobIdFromTargetUrl,
  nextPageUrl,
  REQUIRED_REVIEW_GATES,
  type GateStatus,
} from "#lib/review/harvest.ts";

const JOB = "01a00a5b-1c30-4310-8a10-20ddaaddca65";
const failed: GateStatus = {
  state: "failure",
  targetUrl: `https://buildkite.com/sjerred/monorepo/builds/9633#${JOB}`,
};

test("declares independent Qodo and Codex gate contexts", () => {
  expect(GATE_CONTEXT).toBe(
    "buildkite/monorepo/pr/robot-face-qodo-review-gate-required",
  );
  expect(CODEX_GATE_CONTEXT).toBe(
    "buildkite/monorepo/pr/robot-face-codex-review-gate-required",
  );
  expect(REQUIRED_REVIEW_GATES).toEqual([
    { providerId: "qodo", context: GATE_CONTEXT },
    { providerId: "codex", context: CODEX_GATE_CONTEXT },
  ]);
});

test("rejects malformed blocking-priority configuration", () => {
  expect(() => parseMaxBlockingPriority("2foo")).toThrow(
    "REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3]",
  );
});

describe("jobIdFromTargetUrl", () => {
  test("reads the job out of the URL fragment", () => {
    expect(jobIdFromTargetUrl(failed.targetUrl)).toBe(JOB);
  });

  test("returns null when the status names only a build", () => {
    // Retrying the whole build instead of the job would re-run every step,
    // so a URL without a job must not be treated as retryable.
    expect(
      jobIdFromTargetUrl("https://buildkite.com/sjerred/monorepo/builds/9633"),
    ).toBeNull();
  });

  test("rejects a fragment that is not a job id", () => {
    expect(jobIdFromTargetUrl("https://buildkite.com/x#not-a-uuid")).toBeNull();
    // 36 characters of hex and hyphens, but not a UUID. Anything non-null here
    // is reported as retryable and handed to `bk job retry`.
    expect(
      jobIdFromTargetUrl(`https://buildkite.com/x#${"-".repeat(36)}`),
    ).toBeNull();
    expect(
      jobIdFromTargetUrl(`https://buildkite.com/x#${"a".repeat(36)}`),
    ).toBeNull();
    expect(jobIdFromTargetUrl(null)).toBeNull();
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
    expect(harvestVerdict(stale)).toEqual({ retryable: true, jobId: JOB });
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

  test("does not retry when the status names no job", () => {
    const verdict = harvestVerdict({
      ...stale,
      gate: { state: "failure", targetUrl: null },
    });
    expect(verdict).toEqual({
      retryable: false,
      reason: "gate status names no Buildkite job",
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
