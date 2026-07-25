import { afterEach, describe, expect, test } from "bun:test";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  getReportAiQuotaStatus,
  resetReportAiRateLimitStateForTests,
  tryStartReportAiRun,
} from "#src/reports/ai/rate-limit.ts";

const identity = {
  guildId: DiscordGuildIdSchema.parse("1337623164146155593"),
  userId: DiscordAccountIdSchema.parse("160509172704739328"),
};

afterEach(() => {
  resetReportAiRateLimitStateForTests();
});

describe("report AI rate limit", () => {
  test("exposes every enforced quota window with its reset time", () => {
    const now = 1000;
    const quota = getReportAiQuotaStatus(identity, now).quota;

    expect(
      quota.map(({ scope, window, limit, remaining }) => ({
        scope,
        window,
        limit,
        remaining,
      })),
    ).toEqual([
      { scope: "user_guild", window: "minute", limit: 1, remaining: 1 },
      { scope: "user_guild", window: "hour", limit: 3, remaining: 3 },
      { scope: "user_guild", window: "day", limit: 8, remaining: 8 },
      { scope: "user_guild", window: "week", limit: 30, remaining: 30 },
      { scope: "guild", window: "hour", limit: 5, remaining: 5 },
      { scope: "guild", window: "day", limit: 20, remaining: 20 },
      { scope: "guild", window: "week", limit: 100, remaining: 100 },
      { scope: "global", window: "hour", limit: 30, remaining: 30 },
      { scope: "global", window: "day", limit: 150, remaining: 150 },
      { scope: "global", window: "week", limit: 500, remaining: 500 },
    ]);
    expect(
      quota.map((snapshot) => Date.parse(snapshot.resetsAt) - now),
    ).toEqual([
      60_000, 3_600_000, 86_400_000, 604_800_000, 3_600_000, 86_400_000,
      604_800_000, 3_600_000, 86_400_000, 604_800_000,
    ]);
  });

  test("tracks weekly quota in the user-guild bucket", () => {
    const first = tryStartReportAiRun(identity, 1000);
    expect(first.allowed).toBe(true);
    if (first.allowed) {
      first.finish();
    }

    const week = getReportAiQuotaStatus(identity, 1001).quota.find(
      (snapshot) =>
        snapshot.scope === "user_guild" && snapshot.window === "week",
    );
    expect(week?.used).toBe(1);
    expect(week?.remaining).toBe(29);
  });

  test("blocks concurrent runs for the same user and guild", () => {
    const first = tryStartReportAiRun(identity, 1000);
    expect(first.allowed).toBe(true);

    const second = tryStartReportAiRun(identity, 1001);
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.reason).toContain("already running");
    }

    if (first.allowed) {
      first.finish();
    }
  });

  test("enforces one request per minute per user and guild", () => {
    const first = tryStartReportAiRun(identity, 1000);
    expect(first.allowed).toBe(true);
    if (first.allowed) {
      first.finish();
    }

    const second = tryStartReportAiRun(identity, 2000);
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.retryAfterSeconds).toBe(59);
    }
  });

  test("resets minute quota after the bucket duration elapses", () => {
    const first = tryStartReportAiRun(identity, 1000);
    expect(first.allowed).toBe(true);
    if (first.allowed) {
      first.finish();
    }

    const second = tryStartReportAiRun(identity, 61_000);
    expect(second.allowed).toBe(true);
    if (second.allowed) {
      second.finish();
    }
  });

  test("exempt operators retain concurrency protection without consuming quota", () => {
    const first = tryStartReportAiRun(identity, 1000, { exempt: true });
    expect(first.allowed).toBe(true);
    if (!first.allowed) {
      throw new Error("Expected exempt AI run to start");
    }
    expect(first.quota).toEqual([]);

    const concurrent = tryStartReportAiRun(identity, 1001, { exempt: true });
    expect(concurrent.allowed).toBe(false);
    first.finish();

    const second = tryStartReportAiRun(identity, 1002, { exempt: true });
    expect(second.allowed).toBe(true);
    if (second.allowed) {
      second.finish();
    }
    expect(
      getReportAiQuotaStatus(identity, 1003, { exempt: true }).quota,
    ).toEqual([]);
    const ordinaryWeek = getReportAiQuotaStatus(identity, 1003).quota.find(
      (snapshot) =>
        snapshot.scope === "user_guild" && snapshot.window === "week",
    );
    expect(ordinaryWeek?.used).toBe(0);
  });
});
