import { afterEach, describe, expect, test, vi } from "vitest";
import { codexProvider } from "@shepherdjerred/code-review";
import { GitHubRateLimitError } from "@shepherdjerred/code-review/github-request";
import type { GatePollState } from "./review-gate-observe.ts";
import {
  nextPollDelayMs,
  pollOnce,
  type PollLoopConfig,
  type PollLoopState,
} from "./review-gate-poll.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const config: PollLoopConfig = {
  providers: [codexProvider],
  repo: "shepherdjerred/monorepo",
  number: 3700,
  head: "a".repeat(40),
  token: "token",
  policy: {
    alwaysBlockingPriority: 1,
    maxBlockingPriority: 3,
    lowSeverity: "first-review-or-accompanied",
  },
  configuredGraceSeconds: 600,
  retryAfterSeconds: 900,
  timeoutSeconds: 3600,
  intervalSeconds: 30,
};

function freshPoll(): GatePollState {
  return {
    headPushedAt: null,
    pullRequestAuthor: null,
    attempts: new Map([[codexProvider.id, 1]]),
    lastObservations: new Map(),
    warnedMismatch: false,
    warnedOversized: new Set(),
  };
}

function stubForbidden(headers: Record<string, string>, body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 403, headers })),
  );
}

describe("nextPollDelayMs", () => {
  const now = 1_000_000;

  test("uses the poll interval when nothing is rate limited", () => {
    const state: PollLoopState = { passStreak: 0, lastPollError: null };
    expect(nextPollDelayMs(state, 30, now + 3_600_000, now)).toBe(30_000);
  });

  test("stretches to the rate-limit reset plus bounded jitter", () => {
    const state: PollLoopState = {
      passStreak: 0,
      lastPollError: null,
      resumeAt: now + 600_000,
    };
    const delay = nextPollDelayMs(state, 30, now + 3_600_000, now);
    expect(delay).toBeGreaterThanOrEqual(600_000);
    expect(delay).toBeLessThan(605_000);
  });

  test("never sleeps past the deadline", () => {
    const state: PollLoopState = {
      passStreak: 0,
      lastPollError: null,
      resumeAt: now + 600_000,
    };
    expect(nextPollDelayMs(state, 30, now + 120_000, now)).toBe(120_001);
  });
});

describe("pollOnce rate limits", () => {
  test("waits for the reset instead of failing the gate", async () => {
    vi.spyOn(console, "warn").mockImplementation(vi.fn());
    stubForbidden(
      {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-used": "5000",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "4102444800",
        "x-ratelimit-resource": "core",
      },
      '{"message":"API rate limit exceeded for user ID 1."}',
    );
    const state: PollLoopState = { passStreak: 1, lastPollError: null };

    await expect(
      pollOnce(config, freshPoll(), Date.now(), state),
    ).resolves.toBe(false);

    expect(state.lastPollError).toBeInstanceOf(GitHubRateLimitError);
    expect(state.resumeAt).toBe(4_102_444_800_000);
    expect(state.passStreak).toBe(0);
  });

  test("still fails fast on a permission 403", async () => {
    stubForbidden(
      { "x-ratelimit-remaining": "4000" },
      '{"message":"Resource not accessible by personal access token"}',
    );
    const state: PollLoopState = { passStreak: 0, lastPollError: null };

    await expect(
      pollOnce(config, freshPoll(), Date.now(), state),
    ).rejects.toThrow(/403/u);
    expect(state.resumeAt ?? null).toBeNull();
  });
});
