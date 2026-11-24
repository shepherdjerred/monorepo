import type {
  PromotionAttempt,
  PromotionTarget,
} from "#shared/promotion/model.ts";
import type { PromotionTaskResult } from "./task-contract.ts";
import { promotionObservationText } from "./observation.ts";

export type RedditCommentReceipt = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  parentId: string;
};

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
  page: {
    url: string;
    text: string;
    publishedAt?: string | null;
    redditComment?: RedditCommentReceipt;
  };
}): void {
  const { target, pending, receipt, page } = input;
  const text = promotionObservationText(page.text);
  if (page.url !== receipt.url || !text.includes(receipt.quote))
    throw new Error("Receipt requires exact browser readback");
  if (target.action === "reply")
    assertRedditCommentReceipt(target, pending, receipt, page);
  else if (target.id.startsWith("reddit-"))
    assertRedditReceipt(pending, receipt, page, text);
  if (receipt.status !== "verified") return;
  if (target.discord !== undefined)
    assertFreshDiscordReceipt(page.publishedAt, pending.attemptedAt);
  const { contentExcerpt } = pending;
  const quoteMatches =
    typeof contentExcerpt === "string" && target.action === "reply"
      ? normalized(contentExcerpt).includes(normalized(receipt.quote))
      : contentExcerpt?.includes(receipt.quote) === true;
  if (!quoteMatches && target.action !== "bump")
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

function assertRedditCommentReceipt(
  target: PromotionTarget,
  pending: PromotionAttempt,
  receipt: NonNullable<PromotionTaskResult["receipt"]>,
  page: { url: string; redditComment?: RedditCommentReceipt },
) {
  const comment = page.redditComment;
  const parts = new URL(page.url).pathname.split("/").filter(Boolean);
  const postId = new URL(target.url).pathname.split("/").filter(Boolean)[3];
  const published =
    comment === undefined ? Number.NaN : Date.parse(comment.createdAt);
  if (
    comment === undefined ||
    postId === undefined ||
    parts[3] !== postId ||
    parts[5] !== comment.id ||
    comment.author.toLowerCase() !== "the_storm_mc" ||
    comment.parentId !== `t3_${postId}` ||
    !Number.isFinite(published) ||
    published < Date.parse(pending.attemptedAt) - 60_000
  )
    throw new Error(
      "Reddit reply receipt requires this account's fresh top-level comment permalink",
    );
  if (
    receipt.status === "verified" &&
    (pending.contentExcerpt === null ||
      pending.contentExcerpt === undefined ||
      normalized(comment.body) !== normalized(pending.contentExcerpt) ||
      /^\[(?:removed|deleted)\]$/i.test(comment.body))
  )
    throw new Error(
      "Reddit reply receipt must match the complete text entered by this occurrence",
    );
}

function normalized(text: string) {
  return text.replaceAll(/\s+/g, " ").trim();
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
