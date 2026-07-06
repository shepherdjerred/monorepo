import { describe, expect, test } from "bun:test";
import { classifyCiFailClosed } from "./evaluate-dod.ts";
import type { NormalizedCheck } from "#shared/pr-babysit/dod.ts";

const CI_COMPLETE = "buildkite/monorepo/pr/white-check-mark-ci-complete";

describe("classifyCiFailClosed", () => {
  test("known + required build check passing → green", () => {
    const checks: NormalizedCheck[] = [{ name: CI_COMPLETE, bucket: "pass" }];
    const ci = classifyCiFailClosed(checks, {
      known: true,
      contexts: [CI_COMPLETE],
    });
    expect(ci.green).toBe(true);
    expect(ci.missingRequired).toEqual([]);
  });

  test("known + required build check not yet registered → not green", () => {
    const checks: NormalizedCheck[] = [{ name: "fast", bucket: "pass" }];
    const ci = classifyCiFailClosed(checks, {
      known: true,
      contexts: [CI_COMPLETE],
    });
    expect(ci.green).toBe(false);
    expect(ci.missingRequired).toEqual([CI_COMPLETE]);
  });

  test("babysitter-tracked required contexts (merge-conflict / greptile) are excluded", () => {
    const checks: NormalizedCheck[] = [{ name: "fast", bucket: "pass" }];
    const ci = classifyCiFailClosed(checks, {
      known: true,
      contexts: [
        "ci/merge-conflict",
        "buildkite/monorepo/pr/mag-greptile-review",
      ],
    });
    // Both required contexts are tracked separately → no required gating remains.
    expect(ci.green).toBe(true);
    expect(ci.missingRequired).toEqual([]);
  });

  test("unknown required set → fails closed (never green)", () => {
    const checks: NormalizedCheck[] = [{ name: CI_COMPLETE, bucket: "pass" }];
    const ci = classifyCiFailClosed(checks, {
      known: false,
      reason: "gh api boom",
    });
    expect(ci.green).toBe(false);
    expect(ci.missingRequired.length).toBeGreaterThan(0);
  });
});
