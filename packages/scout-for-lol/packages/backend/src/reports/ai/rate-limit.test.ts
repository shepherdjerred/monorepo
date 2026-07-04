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
});
