import { describe, expect, test, vi } from "vitest";
import { fetchBlockedReason, matchesBlockedSignal } from "./github-blocked.ts";
import { codexProvider } from "./providers/codex.ts";
import { greptileProvider } from "./providers/greptile.ts";

const headPushedAt = "2026-09-23T18:00:00Z";
const afterPush = "2026-09-23T18:01:00Z";
const beforePush = "2026-09-23T17:59:00Z";

// Verbatim from a live chatgpt-codex-connector comment: both halves must match
// so that a partial quote (either sentence on its own) cannot trip the detector.
const USAGE_LIMIT_COMMENT =
  "You have reached your Codex usage limits for code reviews. " +
  "You can see your limits in the Codex usage dashboard. " +
  "To continue using code reviews, add credits to your account " +
  "and enable them for code reviews in your settings.";

describe("matchesBlockedSignal", () => {
  test("matches the verbatim usage-limit comment", () => {
    expect(
      matchesBlockedSignal(
        codexProvider.detectBlocked ?? {
          matches: [],
          reason: "missing-fixture",
          remediation: "missing-fixture",
        },
        USAGE_LIMIT_COMMENT,
      ),
    ).toBe(true);
  });

  test("rejects a comment quoting only one half", () => {
    const strategy = codexProvider.detectBlocked;
    expect(strategy).not.toBeNull();
    if (strategy === null) return;
    expect(
      matchesBlockedSignal(
        strategy,
        "You have reached your Codex usage limits for code reviews.",
      ),
    ).toBe(false);
    expect(
      matchesBlockedSignal(strategy, "Please add credits to your account."),
    ).toBe(false);
  });

  test("rejects a null or unrelated body", () => {
    const strategy = codexProvider.detectBlocked;
    expect(strategy).not.toBeNull();
    if (strategy === null) return;
    expect(matchesBlockedSignal(strategy, null)).toBe(false);
    expect(matchesBlockedSignal(strategy, "### 💡 Codex Review")).toBe(false);
  });
});

function mockIssueComments(
  comments: readonly {
    body: string;
    updated_at: string;
    login: string;
  }[],
): void {
  const fetchImplementation = Object.assign(
    async () =>
      Response.json(
        comments.map((comment) => ({
          body: comment.body,
          updated_at: comment.updated_at,
          html_url: "https://github.com/o/r/issues/1#issuecomment-1",
          user: { login: comment.login },
        })),
      ),
    { preconnect: globalThis.fetch.preconnect },
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);
}

describe("fetchBlockedReason", () => {
  test("returns the reason for a provider-authored limit notice posted after the push", async () => {
    mockIssueComments([
      {
        body: USAGE_LIMIT_COMMENT,
        updated_at: afterPush,
        // REST logins carry the [bot] suffix; the detector must accept it.
        login: "chatgpt-codex-connector[bot]",
      },
    ]);
    try {
      await expect(
        fetchBlockedReason({
          repo: "o/r",
          number: 1,
          token: "token",
          provider: codexProvider,
          headPushedAt,
        }),
      ).resolves.toBe("usage-limited");
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("ignores a limit notice that predates the head push", async () => {
    // The limit was hit for an earlier head; credits may have been added since,
    // so a stale notice must not pin the new head as blocked.
    mockIssueComments([
      {
        body: USAGE_LIMIT_COMMENT,
        updated_at: beforePush,
        login: "chatgpt-codex-connector[bot]",
      },
    ]);
    try {
      await expect(
        fetchBlockedReason({
          repo: "o/r",
          number: 1,
          token: "token",
          provider: codexProvider,
          headPushedAt,
        }),
      ).resolves.toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("stays unbound when the head push time is unknown", async () => {
    mockIssueComments([
      {
        body: USAGE_LIMIT_COMMENT,
        updated_at: afterPush,
        login: "chatgpt-codex-connector[bot]",
      },
    ]);
    try {
      await expect(
        fetchBlockedReason({
          repo: "o/r",
          number: 1,
          token: "token",
          provider: codexProvider,
          headPushedAt: null,
        }),
      ).resolves.toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("ignores a lookalike login quoting the notice", async () => {
    mockIssueComments([
      {
        body: USAGE_LIMIT_COMMENT,
        updated_at: afterPush,
        login: "chatgpt-codex-connector-evil[bot]",
      },
    ]);
    try {
      await expect(
        fetchBlockedReason({
          repo: "o/r",
          number: 1,
          token: "token",
          provider: codexProvider,
          headPushedAt,
        }),
      ).resolves.toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("returns null without fetching for a provider with no blocked signal", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json([]));
    try {
      await expect(
        fetchBlockedReason({
          repo: "o/r",
          number: 1,
          token: "token",
          provider: greptileProvider,
          headPushedAt,
        }),
      ).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
