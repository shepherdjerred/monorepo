import { afterEach, describe, expect, test, vi } from "vitest";
import { matchesBlockedSignal } from "../github-blocked.ts";
import { resolveReviewState } from "../github.ts";
import { isProviderAuthor } from "../identity.ts";
import {
  CODEANT_LOGIN,
  codeantProvider,
  parseCodeantCleanHead,
  parseCodeantFindingTitle,
  parseCodeantSeverity,
} from "./codeant.ts";

const HEAD = "302503932631f49dd910ad03ce7b8aa4e0ef9e0c";
const OLDER_HEAD = "9876543210fedcba9876543210fedcba98765432";

const INLINE_CRITICAL =
  "**Assessment:** 🔴 `Critical`\n\n" +
  "**Suggestion:** Escape untrusted shell arguments before spawning subprocesses.\n\n" +
  "```suggestion\nconst safe = Bun.escapeHTML(input);\n```";

const INLINE_MAJOR =
  "**Assessment:** 🟠 `Major`\n\n" +
  "**Suggestion:** Validate the webhook HMAC signature before parsing JSON.";

const INLINE_MINOR =
  "**Assessment:** 🟡 `Minor`\n\n" +
  "**Suggestion:** Prefer `URLSearchParams` over manual query concatenation.";

function buildStatusComment(
  entries: readonly Record<string, unknown>[],
): string {
  return (
    "## CodeAnt AI PR Review\n\n" +
    "Reviewed your pull request and found no actionable issues.\n" +
    `<!-- codeant-review-status:${JSON.stringify(entries)} -->`
  );
}

describe("parseCodeantSeverity", () => {
  test.each([
    [INLINE_CRITICAL, 0],
    ["**Assessment:** Critical", 0],
    ["**Severity Level:** Blocker", 0],
    ["**Severity Level:** `Critical`", 0],
    [INLINE_MAJOR, 1],
    ["**Assessment:** 🟠 Major", 1],
    ["**Severity Level:** Major", 1],
    [INLINE_MINOR, 2],
    ["**Severity Level:** Minor", 2],
    ["**Severity Level:** Info", 3],
    ["**Assessment:** 🔵 `Info`", 3],
  ])("maps anchored CodeAnt severity labels (%#)", (body, expected) => {
    expect(parseCodeantSeverity(body)).toBe(expected);
  });

  test("never matches prose words like major, minor, or critical without the anchored header", () => {
    expect(
      parseCodeantSeverity(
        "This is a major improvement with minor cleanups and critical test coverage.",
      ),
    ).toBeNull();
    expect(
      parseCodeantSeverity("Assessment: minor adjustment to logging"),
    ).toBeNull();
    expect(
      parseCodeantSeverity("**Assessment:** Needs a minor adjustment"),
    ).toBeNull();
    expect(parseCodeantSeverity(null)).toBeNull();
  });
});

describe("parseCodeantFindingTitle", () => {
  test("extracts the first line after **Suggestion:**", () => {
    expect(parseCodeantFindingTitle(INLINE_CRITICAL)).toBe(
      "Escape untrusted shell arguments before spawning subprocesses.",
    );
    expect(parseCodeantFindingTitle(INLINE_MAJOR)).toBe(
      "Validate the webhook HMAC signature before parsing JSON.",
    );
  });

  test("supports suggestion text on the following line and returns null when absent", () => {
    expect(
      parseCodeantFindingTitle(
        "**Assessment:** 🟡 `Minor`\n**Suggestion:**\n  Remove unused helper parameter.  \nMore prose.",
      ),
    ).toBe("Remove unused helper parameter.");
    expect(parseCodeantFindingTitle("**Assessment:** 🟠 `Major`")).toBeNull();
    expect(
      parseCodeantFindingTitle("**Suggestion:**\n```ts\nconst x = 1;\n```"),
    ).toBeNull();
    expect(parseCodeantFindingTitle(null)).toBeNull();
  });
});

describe("parseCodeantCleanHead", () => {
  test("returns the lowercase commit of the last done === true run", () => {
    const body = buildStatusComment([
      {
        run_id: "run_old",
        label: "Reviewed your PR",
        commit: OLDER_HEAD.toUpperCase(),
        started: "2026-11-24T00:00:00Z",
        finished: "2026-11-24T00:01:00Z",
        done: true,
      },
      {
        run_id: "ccac4a594d01",
        label: "Reviewed your PR",
        commit: HEAD.toUpperCase(),
        started: "2026-11-24T00:02:00Z",
        finished: "2026-11-24T00:03:00Z",
        done: true,
      },
    ]);
    expect(parseCodeantCleanHead(body)).toBe(HEAD);
  });

  test("ignores trailing in-progress runs and falls back to the latest completed run", () => {
    const body = buildStatusComment([
      {
        run_id: "run_1",
        label: "Reviewed your PR",
        commit: OLDER_HEAD,
        done: true,
      },
      {
        run_id: "run_2",
        label: "Reviewing your PR",
        commit: HEAD,
        done: false,
      },
    ]);
    expect(parseCodeantCleanHead(body)).toBe(OLDER_HEAD);
  });

  test.each([
    [
      "only incomplete runs",
      buildStatusComment([{ run_id: "1", commit: HEAD, done: false }]),
    ],
    ["empty array", buildStatusComment([])],
    ["invalid JSON", "<!-- codeant-review-status:[{broken -->"],
    [
      "non-hex SHA",
      buildStatusComment([{ commit: "not-a-valid-sha", done: true }]),
    ],
    [
      "short SHA (<7 chars)",
      buildStatusComment([{ commit: "abc12", done: true }]),
    ],
    ["no marker", "Reviewed your PR cleanly"],
    [
      "duplicate markers",
      `${buildStatusComment([{ commit: HEAD, done: true }])}\n${buildStatusComment([{ commit: HEAD, done: true }])}`,
    ],
    [
      "finding severity present",
      `${buildStatusComment([{ commit: HEAD, done: true }])}\n${INLINE_MINOR}`,
    ],
  ])("returns null for %s", (_label, candidate) => {
    expect(parseCodeantCleanHead(candidate)).toBeNull();
  });
});

describe("codeantProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("declares identity, manual trigger, completion, and block rules", () => {
    expect(codeantProvider.id).toBe("codeant");
    expect(codeantProvider.displayName).toBe("CodeAnt AI");
    expect(codeantProvider.startsReviewOnPush).toBe(false);
    expect(codeantProvider.botAuthoredPullRequestPolicy).toBe("review");
    expect(codeantProvider.authorLogins).toEqual([CODEANT_LOGIN]);
    expect(isProviderAuthor(codeantProvider, "codeant-ai[bot]")).toBe(true);
    expect(isProviderAuthor(codeantProvider, "codeant[bot]")).toBe(false);
    expect(codeantProvider.requestReview).toEqual({
      command: "@codeant-ai: review",
    });
    expect(codeantProvider.detectSkip).toBeNull();
    expect(codeantProvider.findingKey).toBeNull();
    expect(codeantProvider.parseReviewBodyFindings).toBeNull();
  });

  test("matches usage-limit block notices", () => {
    const strategies = codeantProvider.detectBlocked ?? [];
    expect(strategies).toHaveLength(2);
    expect(
      strategies.some((s) =>
        matchesBlockedSignal(
          s,
          "CodeAnt AI rate limit exceeded for this repo.",
        ),
      ),
    ).toBe(true);
    expect(
      strategies.some((s) =>
        matchesBlockedSignal(s, "Monthly PR review limit reached."),
      ),
    ).toBe(true);
    expect(strategies.some((s) => matchesBlockedSignal(s, INLINE_MAJOR))).toBe(
      false,
    );
  });

  test("resolves clean completion via status issue comment bound to head push", async () => {
    const pushed = "2026-11-24T00:00:00Z";
    const statusBody = buildStatusComment([
      {
        run_id: "ccac4a594d01",
        label: "Reviewed your PR",
        commit: HEAD,
        started: "2026-11-24T00:01:00Z",
        finished: "2026-11-24T00:02:00Z",
        done: true,
      },
    ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (url.includes("/reviews?")) {
            return Response.json([]);
          }
          return Response.json([
            {
              user: { login: "codeant-ai[bot]" },
              updated_at: "2026-11-24T00:02:05Z",
              body: statusBody,
            },
          ]);
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );

    await expect(
      resolveReviewState({
        provider: codeantProvider,
        repo: "o/r",
        head: HEAD,
        prNumber: 7,
        token: "token",
        headPushedAt: pushed,
      }),
    ).resolves.toMatchObject({
      state: "reviewed",
      completionSignal: "issue-comment",
      reviewedCommit: HEAD,
    });
  });
});
