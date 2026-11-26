import type { RedditOutreachMetrics } from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import {
  redditOutreachConfig,
  type RedditOutreachSettings,
} from "#config/reddit-outreach.ts";
import type { RedditQualification } from "#activities/promotion/reddit-discovery/decisions.ts";
import type { RedditRequestPost } from "#activities/promotion/reddit-discovery/model.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import {
  RedditNavigationBudget,
  type createRedditOutreachBrowser,
} from "./browser-session.ts";
import { RedditDatasetStorageError } from "./dataset.ts";
import { executeRedditOutreachReply } from "./index.ts";
import type { SweepSummary } from "./sweep-audit.ts";
import { countReason } from "./sweep-evaluation.ts";

// Initial rules/thread checks, composer open, two rules/thread rechecks, receipt.
const MIN_REPLY_PAGE_OPENS = 8;

type PublicationServices = {
  browser: ReturnType<typeof createRedditOutreachBrowser>;
  store: PromotionStore;
  signal: AbortSignal;
  config: { model: string; dailySpendUsd: number };
  settings: RedditOutreachSettings;
  summary: SweepSummary & { metrics: RedditOutreachMetrics };
};

export async function publishCandidate(
  services: PublicationServices,
  input: {
    post: RedditRequestPost;
    reply: string;
    rules: string;
    qualification: RedditQualification;
  },
) {
  const { browser, store, signal, config, settings, summary } = services;
  if (browser.remainingNavigations() < MIN_REPLY_PAGE_OPENS)
    throw new RedditNavigationBudget(
      "Insufficient Reddit page-open budget for posting and verification",
    );
  let archiveFailure: RedditDatasetStorageError | undefined;
  const result = await executeRedditOutreachReply({
    post: input.post,
    replyText: input.reply,
    relevanceReason: input.qualification.reason,
    occurrenceId: `${summary.occurrenceId}/reply/${input.post.id}`,
    settings: { ...settings, ...config },
    store,
    signal,
    inspect: async () => {
      try {
        return await browser.readThread(input.post, true);
      } catch (error) {
        if (error instanceof RedditDatasetStorageError) archiveFailure = error;
        throw error;
      }
    },
    beforeRedditNavigation: browser.beforeRedditNavigation,
    validate: async () =>
      (await browser.readRules(input.post.subreddit, true)) === input.rules,
    enabled: async () => enabledBeforePublish(services, input.post),
  });
  summary.replies.push(result);
  countReason(summary, `publish-${result.status}`);
  if (archiveFailure !== undefined) throw archiveFailure;
  return result.status;
}

async function enabledBeforePublish(
  { signal, settings }: PublicationServices,
  post: RedditRequestPost,
) {
  signal.throwIfAborted();
  const latest = await redditOutreachConfig();
  return (
    latest.enabled &&
    latest.maxRepliesPerDay >= settings.maxRepliesPerDay &&
    latest.maxRepliesPerSweep >= settings.maxRepliesPerSweep &&
    latest.subreddits.some(
      (name) => name.toLowerCase() === post.subreddit.toLowerCase(),
    ) &&
    Date.now() - Date.parse(post.createdAt) <=
      latest.maxPostAgeHours * 3_600_000
  );
}
