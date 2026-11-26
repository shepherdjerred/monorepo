import { S3ServiceException } from "@aws-sdk/client-s3";
import type { RedditOutreachFailureCategory } from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { z } from "zod/v4";
import { PromotionSnapshotBlocked } from "#activities/promotion/access/browser-snapshot.ts";
import { RedditBrowserReadError } from "#activities/promotion/reddit-discovery/browser-reader.ts";
import { DecisionHttpError } from "#activities/promotion/reddit-discovery/decisions.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import { RedditNavigationBudget } from "./browser-session.ts";
import { RedditDatasetStorageError } from "./dataset.ts";
import {
  readRedditPromotionAccount,
  RedditAccountBusy,
  RedditAccountUnavailable,
} from "./ownership.ts";
import type { SweepSummary } from "./sweep-audit.ts";

const BackoffSchema = z.iso.datetime();
const DECISIONS_BACKOFF_KEY = "reddit-outreach/decisions-defer-until.json";

export function readRedditDecisionsBackoff(store: PromotionStore) {
  return store.read(DECISIONS_BACKOFF_KEY, BackoffSchema);
}

async function recordDecisionsBackoff(
  store: PromotionStore,
  retryAt: string | null,
) {
  if (retryAt === null) return;
  const prior = await readRedditDecisionsBackoff(store);
  if (prior === undefined || Date.parse(retryAt) > Date.parse(prior.value))
    await store.put(DECISIONS_BACKOFF_KEY, retryAt, prior?.etag);
}

function failureCategory(error: unknown): RedditOutreachFailureCategory {
  if (error instanceof DecisionHttpError) return "decisions";
  if (
    error instanceof RedditBrowserReadError ||
    error instanceof PromotionSnapshotBlocked
  )
    return "browser";
  return error instanceof S3ServiceException ||
    error instanceof RedditDatasetStorageError
    ? "storage"
    : "other";
}

export function recordSweepFailure(
  summary: SweepSummary,
  subreddit: string,
  error: unknown,
  category = failureCategory(error),
) {
  summary.failureCategory = category;
  summary.failures.push({
    subreddit,
    reason:
      error instanceof Error
        ? error.message
        : "Unexpected Reddit outreach failure",
  });
}

export async function recordSweepStop(
  store: PromotionStore,
  summary: SweepSummary,
  signal: AbortSignal,
  error: unknown,
) {
  if (signal.aborted) {
    summary.stopReason = "deadline";
    return;
  }
  if (error instanceof RedditNavigationBudget) {
    summary.stopReason = "browser-budget";
    return;
  }
  if (error instanceof RedditAccountUnavailable) {
    summary.stopReason = error.kind;
    summary.deferUntil = error.retryAt;
    return;
  }
  if (
    error instanceof RedditBrowserReadError &&
    ["identity", "challenge", "rate-limit"].includes(error.kind)
  ) {
    const account = await readRedditPromotionAccount(store);
    summary.stopReason = account.hold ?? error.kind;
    summary.deferUntil = account.retryAt;
    recordSweepFailure(summary, "reddit account", error);
    return;
  }
  if (error instanceof RedditAccountBusy) {
    summary.stopReason = "account-busy";
    return;
  }
  if (error instanceof DecisionHttpError && error.status === 429) {
    summary.stopReason = "decisions-rate-limit";
    summary.deferUntil = error.retryAt;
    await recordDecisionsBackoff(store, error.retryAt);
  } else {
    summary.stopReason = "blocked";
  }
  recordSweepFailure(summary, "sweep", error);
}
