import { afterEach, describe, expect, test, vi } from "vitest";
import { matchesBlockedSignal } from "../github-blocked.ts";
import { resolveReviewState } from "../github.ts";
import { isProviderAuthor } from "../identity.ts";
import {
  CUBIC_LOGIN,
  cubicProvider,
  parseCubicFindingTitle,
  parseCubicSeverity,
} from "./cubic.ts";

const INLINE_P1_COMMENT =
  "<!-- cubic:v=1 -->\n" +
  "<!-- cubic:review-run=run_01JXYZ987654 -->\n" +
  '<!-- metadata:{"confidence":10} -->\n' +
  "P1: Nx 24 rejects the legacy dependency form in project.json.\n" +
  "\n" +
  "<details>\n" +
  "<summary>Prompt for AI agents</summary>\n" +
  "Replace legacy implicitDependencies entries with explicit project references.\n" +
  "</details>";

const CLEAN_REVIEW_SUMMARY =
  "<!-- cubic:review-summary:start -->\n**No issues found**\n<!-- cubic:review-summary:end -->";

describe("parseCubicSeverity", () => {
  test.each([
    ["P0: Remote code execution via unsanitized argument", 0],
    [INLINE_P1_COMMENT, 1],
    ["  <!-- cubic:v=1 -->\n  P2 : Missing retry backoff on transient 503", 2],
    ['<!-- metadata:{"confidence":8} -->\nP3: Prefer readonly tuple type', 3],
  ])("parses leading P0..P3 prefixes (%#)", (body, expected) => {
    expect(parseCubicSeverity(body)).toBe(expected);
  });

  test("ignores P-tokens buried mid-prose or out of range", () => {
    expect(
      parseCubicSeverity(
        "This change updates the P1: escalation documentation for operators.",
      ),
    ).toBeNull();
    expect(
      parseCubicSeverity("See P0: details in the previous comment."),
    ).toBeNull();
    expect(parseCubicSeverity("P4: Out-of-range priority")).toBeNull();
    expect(parseCubicSeverity(CLEAN_REVIEW_SUMMARY)).toBeNull();
    expect(parseCubicSeverity("<!-- unclosed comment P1: foo")).toBeNull();
    expect(parseCubicSeverity(null)).toBeNull();
  });
});

describe("parseCubicFindingTitle", () => {
  test("extracts the headline after leading metadata comments and priority prefix", () => {
    expect(parseCubicFindingTitle(INLINE_P1_COMMENT)).toBe(
      "Nx 24 rejects the legacy dependency form in project.json.",
    );
  });

  test("stops before inline <details> blocks and trims whitespace", () => {
    expect(
      parseCubicFindingTitle(
        "<!-- cubic:v=1 -->\nP0: Unchecked null dereference <details><summary>More</summary>body</details>",
      ),
    ).toBe("Unchecked null dereference");
  });

  test("returns null when empty or only details remain", () => {
    expect(parseCubicFindingTitle(null)).toBeNull();
    expect(parseCubicFindingTitle("<!-- cubic:v=1 -->\n   ")).toBeNull();
    expect(
      parseCubicFindingTitle(
        "<!-- cubic:v=1 -->\nP2: <details><summary>Only details</summary></details>",
      ),
    ).toBeNull();
  });
});

describe("cubicProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("declares identity, manual trigger, completion, skip, and block rules", () => {
    expect(cubicProvider.id).toBe("cubic");
    expect(cubicProvider.displayName).toBe("Cubic");
    expect(cubicProvider.startsReviewOnPush).toBe(false);
    expect(cubicProvider.botAuthoredPullRequestPolicy).toBe("review");
    expect(cubicProvider.authorLogins).toEqual([CUBIC_LOGIN]);
    expect(isProviderAuthor(cubicProvider, "cubic-dev-ai[bot]")).toBe(true);
    expect(isProviderAuthor(cubicProvider, "cubic-dev-ai-spoof[bot]")).toBe(
      false,
    );
    expect(cubicProvider.completion).toEqual({
      kind: "review-at-head",
      cleanSignal: "none",
    });
    expect(cubicProvider.requestReview).toEqual({
      command: "@cubic-dev-ai review this PR",
    });
    expect(cubicProvider.findingKey).toBeNull();
    expect(cubicProvider.parseReviewBodyFindings).toBeNull();
  });

  test("matches all configured usage-limit block notices", () => {
    const strategies = cubicProvider.detectBlocked ?? [];
    expect(strategies).toHaveLength(3);
    const notices = [
      "This repository has reached full reviewed-line capacity for the billing cycle.",
      "This repository exceeded its public fair-use allowance.",
      "Cubic hit a rate limit while reviewing this pull request.",
    ];
    for (const notice of notices) {
      expect(
        strategies.some((strategy) => matchesBlockedSignal(strategy, notice)),
      ).toBe(true);
    }
    expect(
      strategies.some((strategy) =>
        matchesBlockedSignal(strategy, INLINE_P1_COMMENT),
      ),
    ).toBe(false);
  });

  test("detects a clean COMMENTED review at head and skips oversized diffs", async () => {
    const head = "302503932631f49dd910ad03ce7b8aa4e0ef9e0c";
    const headPushedAt = "2026-11-24T00:00:00Z";

    vi.spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (url.includes("/reviews?")) {
            return Response.json([
              {
                id: 10,
                user: { login: "cubic-dev-ai[bot]" },
                state: "COMMENTED",
                commit_id: head,
                submitted_at: "2026-11-24T00:02:00Z",
                body: CLEAN_REVIEW_SUMMARY,
              },
            ]);
          }
          return Response.json([]);
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );

    await expect(
      resolveReviewState({
        provider: cubicProvider,
        repo: "o/r",
        head,
        prNumber: 42,
        token: "token",
        headPushedAt,
      }),
    ).resolves.toMatchObject({
      state: "reviewed",
      completionSignal: "review-at-head",
      reviewedCommit: head,
      skipReason: null,
    });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (url.includes("/reviews?")) {
            return Response.json([]);
          }
          if (url.includes("/comments")) {
            return Response.json([
              {
                user: { login: "cubic-dev-ai[bot]" },
                updated_at: "2026-11-24T00:01:00Z",
                body: "Skipped review: PR exceeds Cubic's technical review maximum of 50,000 reviewable lines.",
              },
            ]);
          }
          return Response.json([]);
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );

    await expect(
      resolveReviewState({
        provider: cubicProvider,
        repo: "o/r",
        head,
        prNumber: 42,
        token: "token",
        headPushedAt,
      }),
    ).resolves.toMatchObject({
      state: "reviewed",
      completionSignal: "none",
      skipReason: "too-many-files",
    });
  });
});
