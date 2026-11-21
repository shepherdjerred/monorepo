import { describe, expect, it, vi } from "vitest";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import { RedditBrowserReadError } from "#activities/promotion/reddit-discovery/browser-reader.ts";
import {
  readRedditPromotionAccount,
  recordRedditAccountFailure,
  recordRedditAccountSuccess,
  restoreRedditPromotionAccount,
  withRedditPromotionAccount,
} from "./ownership.ts";

describe("shared Reddit account availability", () => {
  it("blocks the next job after a rate-limited browser read and honors its deadline", async () => {
    const store = memoryPromotionStore();
    const retryAt = new Date(Date.now() + 7_200_000).toISOString();
    const rateLimit = new RedditBrowserReadError(
      "rate-limit",
      "Reddit rate limited",
      retryAt,
    );
    await expect(
      withRedditPromotionAccount(store, "outreach", async () => {
        throw rateLimit;
      }),
    ).rejects.toBe(rateLimit);
    const bump = vi.fn(async () => "bumped");
    await expect(
      withRedditPromotionAccount(store, "bump", bump),
    ).rejects.toMatchObject({ kind: "rate-limit", retryAt });
    expect(bump).not.toHaveBeenCalled();
    expect(await readRedditPromotionAccount(store)).toMatchObject({
      owner: null,
      retryAt,
      consecutiveRateLimits: 1,
    });
  });

  it("doubles undisclosed cooldowns and resets after an observed success", async () => {
    const store = memoryPromotionStore();
    const now = Date.parse("2026-11-20T12:00:00Z");
    const first = await recordRedditAccountFailure(
      store,
      { kind: "rate-limit" },
      now,
    );
    expect(first.retryAt).toBe("2026-11-20T12:30:00.000Z");
    const second = await recordRedditAccountFailure(
      store,
      { kind: "rate-limit" },
      now + 1_800_000,
    );
    expect(second.retryAt).toBe("2026-11-20T13:30:00.000Z");
    const during = await recordRedditAccountSuccess(store, now + 3_600_000);
    expect(during.consecutiveRateLimits).toBe(2);
    expect(
      await recordRedditAccountSuccess(store, now + 5_400_000),
    ).toMatchObject({ retryAt: null, consecutiveRateLimits: 0 });
  });

  it("keeps a challenge hold until operator verification succeeds", async () => {
    const store = memoryPromotionStore();
    await recordRedditAccountFailure(store, { kind: "challenge" });
    await recordRedditAccountSuccess(store);
    await expect(
      withRedditPromotionAccount(store, "bump", async () => "ran"),
    ).rejects.toMatchObject({ kind: "challenge" });
    const repair = {
      store,
      owner: "operator",
      reason: "Restored signed-in profile",
    };
    await expect(
      restoreRedditPromotionAccount({
        ...repair,
        verify: async () => {
          throw new RedditBrowserReadError("identity", "Logged out");
        },
      }),
    ).rejects.toThrow("Logged out");
    const account = await readRedditPromotionAccount(store);
    expect(account.hold).toBe("logged-out");
    await expect(
      restoreRedditPromotionAccount({
        ...repair,
        verify: () => Promise.resolve(),
      }),
    ).resolves.toMatchObject({ hold: null });
    await expect(
      withRedditPromotionAccount(store, "outreach", async () => "ready"),
    ).resolves.toBe("ready");
  });
});
