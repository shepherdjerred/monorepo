import type { PromotionAttempt, PromotionTarget } from "#shared/promotion.ts";
import type { PromotionTaskResult } from "./task-contract.ts";

export function assertPromotionTaskReceipt(input: {
  target: PromotionTarget;
  pending: PromotionAttempt;
  receipt: NonNullable<PromotionTaskResult["receipt"]>;
  page: { url: string; text: string; publishedAt?: string | null };
}): void {
  const { target, pending, receipt, page } = input;
  if (page.url !== receipt.url || !page.text.includes(receipt.quote))
    throw new Error("Receipt requires exact browser readback");
  if (receipt.status !== "verified") return;
  if (
    target.action !== "bump" &&
    pending.contentExcerpt?.includes(receipt.quote) !== true
  )
    throw new Error(
      "Receipt quote must match content entered by this occurrence",
    );
  if (
    target.action === "bump" &&
    !pending.beforeSubmission.some((item) => item.url === page.url)
  )
    throw new Error("Bump receipt requires the original page baseline");
  if (
    pending.beforeSubmission.some(
      (item) => item.url === page.url && item.text.includes(receipt.quote),
    )
  )
    throw new Error("Receipt confirmation was already present before this run");
  if (!target.id.startsWith("reddit-")) return;
  const published =
    page.publishedAt === null || page.publishedAt === undefined
      ? Number.NaN
      : Date.parse(page.publishedAt);
  if (
    !/\/comments\/[a-z0-9]+\//i.test(new URL(page.url).pathname) ||
    !Number.isFinite(published) ||
    published < Date.parse(pending.attemptedAt) - 60_000 ||
    /removed by|\[removed\]|pending approval|awaiting moderator/i.test(
      page.text,
    )
  )
    throw new Error(
      "Reddit receipt needs this submission's fresh, visible permalink",
    );
}
