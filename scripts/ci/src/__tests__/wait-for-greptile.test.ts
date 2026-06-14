import { describe, expect, it } from "bun:test";
import {
  compileCheckPattern,
  evaluateGate,
  parseLinkNext,
  parseGreptilePriority,
  parseGreptileSkippedReview,
  type GreptileReviewCheck,
  type GreptileSkipReason,
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
    priority: 2,
    ...overrides,
  };
}

function evaluate(input: {
  reviewCheck?: GreptileReviewCheck;
  threads?: GreptileThread[];
  maxBlockingPriority?: number;
  skippedReview?: GreptileSkipReason | null;
}) {
  return evaluateGate({
    head: HEAD,
    reviewCheck: input.reviewCheck ?? reviewCheck(),
    threads: input.threads ?? [],
    greptileLogin: GREPTILE,
    maxBlockingPriority: input.maxBlockingPriority ?? 3,
    ...(input.skippedReview !== undefined
      ? { skippedReview: input.skippedReview }
      : {}),
  });
}

describe("evaluateGate — skipped-review shortcut", () => {
  it("passes when Greptile reported no reviewable files and there are no blocking threads", () => {
    const result = evaluate({
      // No check-run found; gate passes when skippedReview is set and no blocking threads.
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
      skippedReview: "no-reviewable-files",
    });
    expect(result.state).toBe("passed");
    expect(result.message).toContain("no reviewable files");
    expect(result.message).toContain(HEAD);
  });

  it("passes when Greptile skipped review due to too many files and there are no blocking threads", () => {
    // PR #1166 (~6800 files) hit Greptile's 500-file limit; the gate must
    // short-circuit on the "Too many files changed for review" comment.
    const result = evaluate({
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
      skippedReview: "too-many-files",
    });
    expect(result.state).toBe("passed");
    expect(result.message).toContain("too many files");
    expect(result.message).toContain(HEAD);
  });

  it("still blocks on unresolved threads from earlier commits even when skippedReview is set", () => {
    // An earlier commit may have produced unresolved Greptile threads; GitHub does
    // not automatically mark them outdated when only ignored / overflow files
    // change in the new commit. The skip flag only bypasses the check-run wait.
    const result = evaluate({
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
      threads: [thread({ isResolved: false })],
      skippedReview: "no-reviewable-files",
    });
    expect(result.state).toBe("failed");
    expect(result.message).toContain("unresolved Greptile comment");
  });

  it("still blocks on unresolved threads when skipped due to too many files", () => {
    const result = evaluate({
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
      threads: [thread({ isResolved: false })],
      skippedReview: "too-many-files",
    });
    expect(result.state).toBe("failed");
    expect(result.message).toContain("unresolved Greptile comment");
  });

  it("passes when skippedReview is set and the only threads are resolved", () => {
    const result = evaluate({
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
      threads: [thread({ isResolved: true })],
      skippedReview: "no-reviewable-files",
    });
    expect(result.state).toBe("passed");
  });

  it("does NOT short-circuit when skippedReview is null", () => {
    const result = evaluate({
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
      skippedReview: null,
    });
    expect(result.state).toBe("waiting");
  });

  it("does NOT short-circuit when skippedReview is undefined", () => {
    const result = evaluate({
      reviewCheck: { found: false, status: null, conclusion: null, url: null },
    });
    expect(result.state).toBe("waiting");
  });
});

describe("parseGreptileSkippedReview", () => {
  it('returns "no-reviewable-files" for the exact Greptile status comment body', () => {
    const body =
      "<!-- greptile-status -->\nNo reviewable files after applying ignore patterns.";
    expect(parseGreptileSkippedReview(body)).toBe("no-reviewable-files");
  });

  it('returns "no-reviewable-files" when both markers appear on the same line', () => {
    const body =
      "<!-- greptile-status --> No reviewable files after applying ignore patterns.";
    expect(parseGreptileSkippedReview(body)).toBe("no-reviewable-files");
  });

  it('returns "too-many-files" for Greptile\'s observed too-many-files comment (PR #1166)', () => {
    // Exact body Greptile posted on shepherdjerred/monorepo#1166:
    //   <!-- greptile-status -->
    //   Too many files changed for review. (`3000 files found`, `500 file limit`)
    const body =
      "<!-- greptile-status -->\nToo many files changed for review. (`3000 files found`, `500 file limit`)";
    expect(parseGreptileSkippedReview(body)).toBe("too-many-files");
  });

  it('returns "too-many-files" when the marker and phrase share a line', () => {
    const body =
      "<!-- greptile-status --> Too many files changed for review. (`1000 files found`, `500 file limit`)";
    expect(parseGreptileSkippedReview(body)).toBe("too-many-files");
  });

  it("returns null for a normal Greptile review comment", () => {
    const body =
      "<!-- greptile-status -->\n<h3>Greptile Summary</h3>\n\nThis PR updates dependencies.";
    expect(parseGreptileSkippedReview(body)).toBeNull();
  });

  it("returns null for a comment with only the status marker", () => {
    expect(parseGreptileSkippedReview("<!-- greptile-status -->")).toBeNull();
  });

  it("returns null when the skip phrase appears WITHOUT the greptile-status marker", () => {
    // Defence-in-depth: a human/other bot quoting Greptile must not trip the gate.
    expect(
      parseGreptileSkippedReview(
        "Heads-up: Greptile says 'Too many files changed for review' when diffs exceed 500 files.",
      ),
    ).toBeNull();
    expect(
      parseGreptileSkippedReview(
        "I think we have No reviewable files in this directory.",
      ),
    ).toBeNull();
  });

  it("returns null for a null body", () => {
    expect(parseGreptileSkippedReview(null)).toBeNull();
  });

  it("returns null for an unrelated comment", () => {
    expect(parseGreptileSkippedReview("LGTM!")).toBeNull();
  });
});

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

  it("blocks on a P3 thread under the default threshold (maxBlockingPriority=3)", () => {
    const result = evaluate({
      threads: [thread({ priority: 3 })],
      maxBlockingPriority: 3,
    });
    expect(result.state).toBe("failed");
  });

  it("does NOT block on an un-badged thread (priority: null)", () => {
    const result = evaluate({
      threads: [thread({ priority: null })],
      maxBlockingPriority: 3,
    });
    expect(result.state).toBe("passed");
  });

  it("with maxBlockingPriority=2: a P3 thread does NOT block but a P2 thread does", () => {
    const resultP3 = evaluate({
      threads: [thread({ priority: 3 })],
      maxBlockingPriority: 2,
    });
    expect(resultP3.state).toBe("passed");

    const resultP2 = evaluate({
      threads: [thread({ priority: 2 })],
      maxBlockingPriority: 2,
    });
    expect(resultP2.state).toBe("failed");
  });

  it("failed message includes the priority label", () => {
    const result = evaluate({
      threads: [
        thread({
          priority: 2,
          path: "scripts/ci/src/wait-for-greptile.ts",
          line: 262,
          url: "https://github.com/shepherdjerred/monorepo/pull/1026#discussion_r262",
        }),
      ],
    });
    expect(result.state).toBe("failed");
    expect(result.message).toContain("P2");
  });
});

describe("parseGreptilePriority", () => {
  it("parses P2 from an alt=P2 style body", () => {
    const body =
      '<a href="#"><img alt="P2" src="https://greptile-static-assets.s3.amazonaws.com/badges/p2.svg?v=9" align="top"></a> **Title**';
    expect(parseGreptilePriority(body)).toBe(2);
  });

  it("parses each priority from alt-attribute style", () => {
    for (const n of [0, 1, 2, 3]) {
      expect(parseGreptilePriority(`<img alt="P${String(n)}" />`)).toBe(n);
    }
  });

  it("parses P3 from a badges/p3.svg style body (fallback match)", () => {
    const body =
      '<img src="https://greptile-static-assets.s3.amazonaws.com/badges/p3.svg" />';
    expect(parseGreptilePriority(body)).toBe(3);
  });

  it("parses each priority from badge URL style", () => {
    for (const n of [0, 1, 2, 3]) {
      expect(
        parseGreptilePriority(`<img src="badges/p${String(n)}.svg" />`),
      ).toBe(n);
    }
  });

  it("returns null for a body with no badge", () => {
    expect(
      parseGreptilePriority("This is a comment with no badge."),
    ).toBeNull();
  });

  it("returns null for a null body", () => {
    expect(parseGreptilePriority(null)).toBeNull();
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
