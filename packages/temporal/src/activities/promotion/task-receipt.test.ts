import { describe, expect, it } from "vitest";
import { assertPromotionTaskReceipt } from "./task-receipt.ts";
import { promotionTarget } from "./manifest.ts";
import type { PromotionAttempt } from "#shared/promotion.ts";

const target = promotionTarget("reddit-mcservers");
const pending: PromotionAttempt = {
  occurrenceId: "fixture",
  attemptedAt: "2026-10-26T12:00:00.000Z",
  settledAt: null,
  status: "uncertain",
  contentHash: "fixture",
  contentExcerpt: "The Storm [SMP] {Java & Bedrock}",
  receiptUrl: null,
  evidenceKey: null,
  beforeSubmission: [],
};
const page = {
  url: `${target.url}comments/fixture/the_storm/`,
  text: "The Storm [SMP] {Java & Bedrock}",
  publishedAt: "2026-10-26T12:00:02.000Z",
};
const receipt = {
  status: "verified" as const,
  url: page.url,
  quote: page.text,
  occurrenceId: null,
};

describe("task receipt validation", () => {
  it("accepts a fresh receipt bound to the text entered in this run", () => {
    expect(() =>
      assertPromotionTaskReceipt({ target, pending, page, receipt }),
    ).not.toThrow();
  });
  it("rejects another author's recent post even when its quote appears remotely", () => {
    const unrelated = "Another server [SMP]";
    expect(() =>
      assertPromotionTaskReceipt({
        target,
        pending,
        page: { ...page, text: unrelated },
        receipt: { ...receipt, quote: unrelated },
      }),
    ).toThrow("content entered");
  });
  it.each([null, "2026-10-25T12:00:00.000Z"])(
    "refuses missing/stale original post timestamps (%s)",
    (publishedAt) => {
      expect(() =>
        assertPromotionTaskReceipt({
          target,
          pending,
          page: { ...page, publishedAt },
          receipt,
        }),
      ).toThrow("fresh, visible permalink");
    },
  );
  it("keeps filtered and removed content from becoming verified", () => {
    expect(() =>
      assertPromotionTaskReceipt({
        target,
        pending,
        page: { ...page, text: `${page.text} [removed]` },
        receipt,
      }),
    ).toThrow("fresh, visible permalink");
    expect(() =>
      assertPromotionTaskReceipt({
        target,
        pending,
        page,
        receipt: { ...receipt, status: "filtered" },
      }),
    ).not.toThrow();
  });
  it("retains uncertainty for old attempts without a content excerpt", () => {
    expect(() =>
      assertPromotionTaskReceipt({
        target,
        pending: { ...pending, contentExcerpt: null },
        page,
        receipt,
      }),
    ).toThrow("content entered");
  });
});
