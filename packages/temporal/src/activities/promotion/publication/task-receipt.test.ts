import { describe, expect, it } from "vitest";
import { assertPromotionTaskReceipt } from "./task-receipt.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { REDDIT_OUTREACH_LINK } from "#activities/promotion/reddit-discovery/relevance.ts";
import type { PromotionAttempt } from "#shared/promotion/model.ts";

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
  it("accepts a fresh public Reddit reply whose rendered quote joins the invite line", () => {
    const thread = new URL("comments/post1/", target.url);
    const url = new URL("comment/reply1/", thread).href;
    const contentExcerpt = `hi! our server has permanent survival worlds.\n${REDDIT_OUTREACH_LINK}`;
    const quote = contentExcerpt.replace("\n", " ");
    const input = {
      target: { ...target, action: "reply" as const, url: thread.href },
      pending: { ...pending, contentExcerpt },
      receipt: { ...receipt, url, quote },
      page: {
        url,
        text: quote,
        redditComment: {
          id: "reply1",
          author: "the_storm_mc",
          parentId: "t3_post1",
          createdAt: page.publishedAt,
          body: quote,
        },
      },
    };
    expect(() => assertPromotionTaskReceipt(input)).not.toThrow();
    expect(() =>
      assertPromotionTaskReceipt({
        ...input,
        page: {
          ...input.page,
          redditComment: {
            ...input.page.redditComment,
            body: `${quote} Extra.`,
          },
        },
      }),
    ).toThrow("complete text entered");
  });

  it.each(['Your listing "The Storm" was bumped', "Saved \\ path\nToday"])(
    "decodes native receipt text and checks freshness consistently: %s",
    (quote) => {
      const bump = promotionTarget("pmc");
      const encoded = JSON.stringify({
        snapshot: { nodes: [{ name: quote }] },
      });
      const capture = { url: bump.url, text: encoded };
      const confirmation = { ...receipt, url: bump.url, quote };
      const before = {
        id: "before",
        capturedAt: pending.attemptedAt,
        url: bump.url,
        text: "Original listing",
      };
      expect(() =>
        assertPromotionTaskReceipt({
          target: bump,
          pending: { ...pending, beforeSubmission: [before] },
          page: capture,
          receipt: confirmation,
        }),
      ).not.toThrow();
      expect(() =>
        assertPromotionTaskReceipt({
          target: bump,
          pending: {
            ...pending,
            beforeSubmission: [{ ...before, text: encoded }],
          },
          page: capture,
          receipt: confirmation,
        }),
      ).toThrow("already present");
    },
  );
  it("rejects malformed native observations instead of treating them as plain text", () => {
    expect(() =>
      assertPromotionTaskReceipt({
        target,
        pending,
        page: { ...page, text: '{"snapshot":{}' },
        receipt,
      }),
    ).toThrow();
  });
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
  it.each(["filtered", "rejected"] as const)(
    "refuses stale or unrelated negative %s receipts",
    (status) => {
      const negative = { ...receipt, status, quote: "[removed]" };
      const removed = { ...page, text: `${page.text} [removed]` };
      expect(() =>
        assertPromotionTaskReceipt({
          target,
          pending,
          page: removed,
          receipt: negative,
        }),
      ).not.toThrow();
      expect(() =>
        assertPromotionTaskReceipt({
          target,
          pending,
          page: { ...removed, publishedAt: "2026-10-25T12:00:00Z" },
          receipt: negative,
        }),
      ).toThrow("fresh, visible permalink");
      expect(() =>
        assertPromotionTaskReceipt({
          target,
          pending,
          page: { ...removed, text: "Another server [removed]" },
          receipt: negative,
        }),
      ).toThrow("content entered");
      expect(() =>
        assertPromotionTaskReceipt({
          target,
          pending: {
            ...pending,
            beforeSubmission: [
              {
                id: "old",
                capturedAt: pending.attemptedAt,
                url: removed.url,
                text: removed.text,
              },
            ],
          },
          page: removed,
          receipt: negative,
        }),
      ).toThrow("already present");
    },
  );
});
