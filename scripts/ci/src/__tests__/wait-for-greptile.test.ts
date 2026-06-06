import { describe, expect, it } from "bun:test";
import {
  compileCheckPattern,
  evaluateGate,
  parseLinkNext,
  type GreptileReviewCheck,
  type GreptileThread,
} from "../wait-for-greptile.ts";

const HEAD = "9a91e0c1ab74dea12c00b7c725e92c842a8da7e2";
const GREPTILE = "greptile-apps";

function reviewCheck(
  overrides: Partial<GreptileReviewCheck> = {},
): GreptileReviewCheck {
  return {
    found: true,
    status: "completed",
    conclusion: "success",
    url: "https://github.com/shepherdjerred/monorepo/runs/1",
    ...overrides,
  };
}

function thread(overrides: Partial<GreptileThread> = {}): GreptileThread {
  return {
    authorLogin: GREPTILE,
    isResolved: false,
    isOutdated: false,
    path: "scripts/ci/src/wait-for-greptile.ts",
    line: 42,
    url: "https://github.com/shepherdjerred/monorepo/pull/1026#discussion_r1",
    ...overrides,
  };
}

function evaluate(input: {
  reviewCheck?: GreptileReviewCheck;
  threads?: GreptileThread[];
}) {
  return evaluateGate({
    head: HEAD,
    reviewCheck: input.reviewCheck ?? reviewCheck(),
    threads: input.threads ?? [],
    greptileLogin: GREPTILE,
  });
}

describe("evaluateGate — review-check gating", () => {
  it("waits while Greptile has not started reviewing the head commit", () => {
    const result = evaluate({
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
    });
    expect(result.state).toBe("waiting");
    expect(result.message).toContain("not started");
  });

  it("waits while Greptile is still reviewing the head commit", () => {
    const result = evaluate({
      reviewCheck: reviewCheck({ status: "in_progress", conclusion: null }),
    });
    expect(result.state).toBe("waiting");
    expect(result.message).toContain("in_progress");
  });

  it("fails fast when Greptile's review job concluded with failure", () => {
    const result = evaluate({
      reviewCheck: reviewCheck({ conclusion: "failure" }),
      threads: [thread({ isResolved: true })],
    });
    expect(result.state).toBe("failed");
    expect(result.message).toContain("did not complete successfully");
    expect(result.message).toContain("Re-trigger Greptile");
  });

  it.each(["cancelled", "timed_out", "startup_failure"] as const)(
    "treats terminal job conclusion %s as errored",
    (conclusion) => {
      const result = evaluate({ reviewCheck: reviewCheck({ conclusion }) });
      expect(result.state).toBe("failed");
      expect(result.message).toContain("did not complete successfully");
    },
  );

  it.each(["success", "neutral", "skipped", "action_required"] as const)(
    "treats conclusion %s as a completed review and evaluates threads",
    (conclusion) => {
      const result = evaluate({ reviewCheck: reviewCheck({ conclusion }) });
      // No threads -> passes, proving we reached thread evaluation.
      expect(result.state).toBe("passed");
    },
  );
});

describe("evaluateGate — comment-resolution gating", () => {
  it("passes when Greptile reviewed head and left no comments", () => {
    const result = evaluate({ threads: [] });
    expect(result.state).toBe("passed");
    expect(result.message).toContain("no unresolved Greptile comments");
  });

  it("passes when every Greptile thread on the latest revision is resolved", () => {
    const result = evaluate({
      threads: [thread({ isResolved: true }), thread({ isResolved: true })],
    });
    expect(result.state).toBe("passed");
  });

  it("ignores outdated (previous-revision) Greptile comments", () => {
    const result = evaluate({
      threads: [thread({ isResolved: false, isOutdated: true })],
    });
    expect(result.state).toBe("passed");
  });

  it("ignores threads authored by non-Greptile reviewers", () => {
    const result = evaluate({
      threads: [thread({ authorLogin: "shepherdjerred", isResolved: false })],
    });
    expect(result.state).toBe("passed");
  });

  it("fails and lists each unresolved Greptile comment on the latest revision", () => {
    const result = evaluate({
      threads: [
        thread({ isResolved: true }),
        thread({
          isResolved: false,
          path: "scripts/ci/src/wait-for-greptile.ts",
          line: 262,
          url: "https://github.com/shepherdjerred/monorepo/pull/1026#discussion_r262",
        }),
        thread({ authorLogin: "shepherdjerred", isResolved: false }),
      ],
    });
    expect(result.state).toBe("failed");
    expect(result.message).toContain("1 unresolved Greptile comment");
    expect(result.message).toContain("scripts/ci/src/wait-for-greptile.ts:262");
    expect(result.message).toContain("#discussion_r262");
    expect(result.message).toContain("re-run this step");
  });

  it("renders general (file-less) comments without a line suffix", () => {
    const result = evaluate({
      threads: [thread({ path: null, line: null, url: null })],
    });
    expect(result.state).toBe("failed");
    expect(result.message).toContain("(general comment)");
  });
});

describe("compileCheckPattern", () => {
  it("defaults to a case-insensitive /greptile/ matcher", () => {
    const pattern = compileCheckPattern(undefined);
    expect(pattern.test("Greptile Review")).toBe(true);
    expect(pattern.test("buildkite/lint")).toBe(false);
  });

  it("falls back to the default for blank values", () => {
    expect(compileCheckPattern("   ").test("greptile")).toBe(true);
  });

  it("honours a custom pattern", () => {
    const pattern = compileCheckPattern("^greptile/review$");
    expect(pattern.test("greptile/review")).toBe(true);
    expect(pattern.test("Greptile Review")).toBe(false);
  });

  it("throws an actionable error for an invalid pattern", () => {
    expect(() => compileCheckPattern("[unclosed")).toThrow(
      /GREPTILE_CHECK_PATTERN is not a valid regular expression/u,
    );
  });
});

describe("parseLinkNext", () => {
  it("returns null when there is no Link header", () => {
    expect(parseLinkNext(null)).toBeNull();
  });

  it("extracts the rel=next URL", () => {
    const header =
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"';
    expect(parseLinkNext(header)).toBe("https://api.github.com/x?page=2");
  });

  it("returns null when only non-next relations are present", () => {
    const header =
      '<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=1>; rel="first"';
    expect(parseLinkNext(header)).toBeNull();
  });
});
