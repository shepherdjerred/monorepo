import { Context } from "@temporalio/activity";
import {
  promotionStore,
  readPromotionState,
  updatePromotionState,
} from "#activities/promotion/store.ts";
import { promotionRequiredEnv } from "#activities/promotion/transport.ts";
import { savePromotionEvidence } from "#activities/promotion/publication/evidence.ts";
import {
  capturePublicRedditReceipt,
  publicRedditReceiptUrl,
} from "#activities/promotion/publication/public-receipt.ts";
import { assertPromotionTaskReceipt } from "#activities/promotion/publication/task-receipt.ts";
import { redditReplyTarget } from "./index.ts";
import { finishRedditReply, readRedditReplyRecord } from "./ledger.ts";

/** Resolve a saved checkpoint using a public readback, without another send. */
export async function reconcileRedditOutreachReply(input: {
  postId: string;
  commentUrl: string;
}) {
  const context = Context.current();
  if (context.info.namespace !== "prod")
    throw new Error("Reddit reply reconciliation requires prod");
  const store = promotionStore();
  const record = await readRedditReplyRecord(store, input.postId);
  if (record === undefined) throw new Error("No saved Reddit reply claim");
  if (record.status === "verified") return record.receiptUrl;
  const target = redditReplyTarget(record.post);
  const state = await readPromotionState(store, target.id);
  const attempt = state.attempts.find(
    (item) => item.occurrenceId === record.occurrenceId,
  );
  if (attempt?.contentExcerpt !== record.replyText)
    throw new Error("No matching Reddit send checkpoint");
  const url =
    attempt.status === "verified"
      ? attempt.receiptUrl
      : await verifyOriginalReply({
          target,
          attempt,
          commentUrl: input.commentUrl,
          store,
        });
  if (url === null)
    throw new Error("Verified Reddit reply is missing its receipt");
  await finishRedditReply(store, {
    postId: record.postId,
    occurrenceId: record.occurrenceId,
    status: "verified",
    completedAt: new Date().toISOString(),
    receiptUrl: url,
    summary:
      "Confirmed the original reply from its signed-out comment permalink",
  });
  return url;
}

async function verifyOriginalReply(input: {
  target: ReturnType<typeof redditReplyTarget>;
  attempt: Awaited<ReturnType<typeof readPromotionState>>["attempts"][number];
  commentUrl: string;
  store: ReturnType<typeof promotionStore>;
}) {
  const { target, attempt, store } = input;
  if (attempt.status !== "uncertain")
    throw new Error("Reddit send checkpoint is already settled");
  const url = publicRedditReceiptUrl(input.commentUrl);
  const quote = attempt.contentExcerpt?.split("https://")[0]?.trim();
  if (quote === undefined || quote === "")
    throw new Error("Reddit checkpoint lacks verifiable reply text");
  const page = await capturePublicRedditReceipt({
    target,
    url,
    expectedQuote: quote,
    baseUrl: promotionRequiredEnv("PINCHTAB_BASE_URL"),
    token: promotionRequiredEnv("PINCHTAB_TOKEN"),
    signal: Context.current().cancellationSignal,
    saveEvidence: (bytes) =>
      savePromotionEvidence(target.id, attempt.occurrenceId, bytes, false),
  });
  const receipt = {
    status: "verified" as const,
    url,
    quote,
    occurrenceId: attempt.occurrenceId,
  };
  assertPromotionTaskReceipt({ target, pending: attempt, receipt, page });
  const settledAt = new Date().toISOString();
  await updatePromotionState(store, target.id, (current) => ({
    ...current,
    lock: null,
    blockedReason: null,
    attempts: current.attempts.map((item) =>
      item.occurrenceId === attempt.occurrenceId
        ? {
            ...item,
            status: "verified",
            receiptUrl: url,
            evidenceKey: page.screenshotKey,
            settledAt,
          }
        : item,
    ),
  }));
  return url;
}
