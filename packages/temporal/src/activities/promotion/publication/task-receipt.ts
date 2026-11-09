import type { PromotionAttempt, PromotionTarget } from "#shared/promotion.ts";
import type { PromotionTaskResult } from "./task-contract.ts";
import { promotionObservationText } from "./observation.ts";

function assertFreshDiscordReceipt(
  publishedAt: string | null | undefined,
  attemptedAt: string,
) {
  if (
    publishedAt === undefined ||
    publishedAt === null ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    Date.parse(publishedAt) < Date.parse(attemptedAt) - 60_000
  )
    throw new Error("Discord receipt predates this occurrence");
}

export function assertPromotionTaskReceipt(input: {
  target: PromotionTarget;
  pending: PromotionAttempt;
  receipt: NonNullable<PromotionTaskResult["receipt"]>;
  page: { url: string; text: string; publishedAt?: string | null };
}): void {
  const { target, pending, receipt, page } = input;
  const text = promotionObservationText(page.text);
  if (page.url !== receipt.url || !text.includes(receipt.quote))
    throw new Error("Receipt requires exact browser readback");
  if (target.id.startsWith("reddit-"))
    assertRedditReceipt(pending, receipt, page, text);
  if (receipt.status !== "verified") return;
  if (target.discord !== undefined)
    assertFreshDiscordReceipt(page.publishedAt, pending.attemptedAt);
  if (
    target.action !== "bump" &&
    pending.contentExcerpt?.includes(receipt.quote) !== true
  )
    throw new Error(
      "Receipt quote must match content entered by this occurrence",
    );
  if (
    target.action === "bump" &&
    target.discord === undefined &&
    !pending.beforeSubmission.some((item) => item.url === page.url)
  )
    throw new Error("Bump receipt requires the original page baseline");
  if (
    pending.beforeSubmission.some(
      (item) =>
        item.url === page.url &&
        promotionObservationText(item.text).includes(receipt.quote),
    )
  )
    throw new Error("Receipt confirmation was already present before this run");
}

function assertRedditReceipt(
  pending: PromotionAttempt,
  receipt: NonNullable<PromotionTaskResult["receipt"]>,
  page: { url: string; publishedAt?: string | null },
  text: string,
) {
  const published =
    page.publishedAt === null || page.publishedAt === undefined
      ? Number.NaN
      : Date.parse(page.publishedAt);
  if (
    !/\/comments\/[a-z0-9]+\//i.test(new URL(page.url).pathname) ||
    !Number.isFinite(published) ||
    published < Date.parse(pending.attemptedAt) - 60_000 ||
    (receipt.status === "verified" &&
      /removed by|\[removed\]|pending approval|awaiting moderator/i.test(text))
  )
    throw new Error(
      "Reddit receipt needs this submission's fresh, visible permalink",
    );
  const title = pending.contentExcerpt?.split("\n")[0];
  if (title === undefined || title === "" || !text.includes(title))
    throw new Error(
      "Reddit receipt must match content entered by this occurrence",
    );
  if (
    pending.beforeSubmission.some(
      (item) =>
        item.url === page.url &&
        promotionObservationText(item.text).includes(receipt.quote),
    )
  )
    throw new Error("Receipt confirmation was already present before this run");
}
