import { describe, expect, it } from "vitest";
import { assertPromotionUrl, policyEligibleAt } from "./promotion.ts";
import type { PromotionTarget } from "./promotion.ts";

describe("promotion history and target boundaries", () => {
  it("calculates a rolling boundary from the Nth newest action", () => {
    const now = Date.parse("2026-10-26T12:00:00.000Z");
    const policy = {
      kind: "rolling" as const,
      maxActions: 2,
      windowSeconds: 3600,
    };
    expect(
      policyEligibleAt(policy, [now - 1000, now - 2000, now - 4000], now),
    ).toBe(now - 2000 + 3_600_000);
    expect(() => policyEligibleAt(policy, [now + 1], now)).toThrow("future");
  });
  it("retains real calendar boundaries across daylight saving", () => {
    const now = Date.parse("2026-11-01T08:30:00.000Z");
    expect(
      policyEligibleAt(
        {
          kind: "calendar-day",
          maxActions: 1,
          timezone: "America/Los_Angeles",
        },
        [now],
        now,
      ),
    ).toBe(Date.parse("2026-11-02T08:00:00.000Z"));
  });
  it("limits Reddit to old.reddit.com and the target community/history", () => {
    const reddit: PromotionTarget = {
      id: "reddit-mcservers",
      name: "Minecraft Servers",
      account: "reddit",
      url: "https://old.reddit.com/r/mcservers/",
      rulesUrl: "https://old.reddit.com/r/mcservers/",
      hosts: ["old.reddit.com"],
      action: "repost",
      content: "reddit-mcservers",
      minimumIntervalSeconds: 604_800,
      notes: "Fixture community",
    };
    expect(() =>
      assertPromotionUrl(reddit, "https://www.reddit.com/r/mcservers/"),
    ).toThrow("scope");
    expect(() =>
      assertPromotionUrl(reddit, "https://old.reddit.com/r/other/submit"),
    ).toThrow("community");
    expect(
      assertPromotionUrl(
        reddit,
        "https://old.reddit.com/user/the_storm_mc/submitted/",
      ).hostname,
    ).toBe("old.reddit.com");
    expect(() =>
      assertPromotionUrl(
        reddit,
        "https://user:password@old.reddit.com/r/mcservers/",
      ),
    ).toThrow("scope");
  });
});
