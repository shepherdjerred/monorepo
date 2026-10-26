import { describe, expect, it } from "vitest";
import { promotionTarget } from "./manifest.ts";
import { assertPromotionReceipt } from "./receipt.ts";

describe("remote promotion receipts", () => {
  it("rejects unchanged page text as proof of a new bump", () => {
    const target = promotionTarget("pmc");
    expect(() =>
      assertPromotionReceipt({
        target,
        status: "verified",
        url: target.url,
        text: "Server bumped successfully",
        quote: "Server bumped successfully",
        attemptedAt: "2026-10-25T12:00:00.000Z",
        before: [
          {
            id: "fixture",
            url: target.url,
            text: "Server bumped successfully",
            capturedAt: "2026-10-25T12:00:00.000Z",
          },
        ],
      }),
    ).toThrow("already present");
  });
  it("requires a new public Reddit post with its original post timestamp", () => {
    const input = {
      target: promotionTarget("reddit-mcservers"),
      status: "verified" as const,
      url: "https://old.reddit.com/r/mcservers/comments/abcdef/the_storm/",
      text: "The Storm survival server",
      quote: "The Storm survival server",
      attemptedAt: "2026-10-25T12:00:00.000Z",
      before: [],
    };
    expect(() => assertPromotionReceipt(input)).toThrow("timestamp");
    expect(() =>
      assertPromotionReceipt({
        ...input,
        publishedAt: "2026-10-24T12:00:00.000Z",
      }),
    ).toThrow("timestamp");
    expect(() =>
      assertPromotionReceipt({
        ...input,
        publishedAt: "2026-10-25T12:00:01.000Z",
        text: "Removed by moderators",
      }),
    ).toThrow("removed");
    expect(() =>
      assertPromotionReceipt({
        ...input,
        publishedAt: "2026-10-25T12:00:01.000Z",
      }),
    ).not.toThrow();
  });
});
