import { describe, expect, test } from "bun:test";
import {
  evaluateGate,
  isBlocking,
  reviewGateSkipReasonForAuthor,
} from "./gate.ts";
import { codexProvider } from "./providers/codex.ts";
import { greptileProvider } from "./providers/greptile.ts";
import type { ReviewThread } from "./types.ts";

function thread(overrides: Partial<ReviewThread>): ReviewThread {
  return {
    authorLogin: "chatgpt-codex-connector",
    isResolved: false,
    isOutdated: false,
    path: "src/x.ts",
    line: 10,
    url: "https://github.com/o/r/pull/1#d",
    priority: 2,
    ...overrides,
  };
}

describe("reviewGateSkipReasonForAuthor", () => {
  test("skips an author whose GitHub account type is Bot", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        login: "long-summer-intern[bot]",
        type: "Bot",
      }),
    ).toBe("bot-author");
  });

  test("does not skip a human author", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        login: "shepherdjerred",
        type: "User",
      }),
    ).toBeNull();
  });

  test("fails closed for a new GitHub account type", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        login: "future-service",
        type: "ServiceAccount",
      }),
    ).toBeNull();
  });

  test("does not infer bot status from the login", () => {
    expect(
      reviewGateSkipReasonForAuthor({
        login: "lookalike[bot]",
        type: "User",
      }),
    ).toBeNull();
  });
});

describe("isBlocking", () => {
  test("blocks an unresolved, non-outdated provider thread within threshold", () => {
    expect(isBlocking(thread({}), codexProvider, 3)).toBe(true);
  });
  test("does not block a resolved thread", () => {
    expect(isBlocking(thread({ isResolved: true }), codexProvider, 3)).toBe(
      false,
    );
  });
  test("does not block an outdated thread", () => {
    expect(isBlocking(thread({ isOutdated: true }), codexProvider, 3)).toBe(
      false,
    );
  });
  test("does not block a thread from another author", () => {
    expect(
      isBlocking(thread({ authorLogin: "some-human" }), codexProvider, 3),
    ).toBe(false);
  });
  test("does not block a thread below the priority threshold", () => {
    expect(isBlocking(thread({ priority: 3 }), codexProvider, 2)).toBe(false);
  });
  test("does not block a thread with no severity badge", () => {
    expect(isBlocking(thread({ priority: null }), codexProvider, 3)).toBe(
      false,
    );
  });
  test("matches the REST [bot] login form", () => {
    expect(
      isBlocking(
        thread({ authorLogin: "chatgpt-codex-connector[bot]" }),
        codexProvider,
        3,
      ),
    ).toBe(true);
  });
});

describe("evaluateGate", () => {
  const base = {
    head: "abc123",
    provider: codexProvider,
    maxBlockingPriority: 3,
  };

  test("waits while reviewing", () => {
    const d = evaluateGate({ ...base, reviewState: "reviewing", threads: [] });
    expect(d.state).toBe("waiting");
  });

  test("fails when errored", () => {
    const d = evaluateGate({ ...base, reviewState: "errored", threads: [] });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("Codex");
  });

  test("passes when reviewed with no blocking threads", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [thread({ isResolved: true })],
    });
    expect(d.state).toBe("passed");
  });

  test("fails when reviewed with a blocking thread", () => {
    const d = evaluateGate({
      ...base,
      reviewState: "reviewed",
      threads: [thread({})],
    });
    expect(d.state).toBe("failed");
    expect(d.message).toContain("1 unresolved Codex comment");
    expect(d.message).toContain("P2");
  });

  test("passes on a skip with the reason in the message", () => {
    const d = evaluateGate({
      ...base,
      provider: greptileProvider,
      reviewState: "reviewed",
      threads: [],
      skipReason: "no-reviewable-files",
    });
    expect(d.state).toBe("passed");
    expect(d.message).toContain("no-reviewable-files");
    expect(d.message).toContain("Greptile");
  });
});
