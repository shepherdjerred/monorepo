import { setTimeout } from "node:timers/promises";
import {
  PromotionTargetSchema,
  type PromotionTarget,
} from "#shared/promotion/model.ts";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionRequiredEnv } from "#activities/promotion/transport.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import type { RedditListingPost } from "#activities/promotion/reddit-discovery/model.ts";
import {
  RedditBrowserReadError,
  validateRedditFeedPageUrl,
} from "#activities/promotion/reddit-discovery/browser-reader.ts";
import type { RedditDatasetArchive } from "./dataset.ts";
import {
  recordRedditAccountFailure,
  recordRedditAccountSuccess,
  withRedditPromotionAccount,
} from "./ownership.ts";
import { redditReplyTarget } from "./index.ts";

export const REDDIT_OUTREACH_ACCOUNT = "the_storm_mc";
const MIN_NAVIGATION_GAP_MS = 2000;

export class RedditNavigationBudget extends Error {}

export function createRedditOutreachBrowser(input: {
  store: PromotionStore;
  occurrenceId: string;
  signal: AbortSignal;
  dataset: RedditDatasetArchive;
  maxNavigations: number;
  onNavigation: () => void;
  onCleanupFailure: (error: unknown) => void;
}) {
  let navigations = 0;
  let nextNavigation = 0;
  const beforeRedditNavigation = async () => {
    input.signal.throwIfAborted();
    if (navigations >= input.maxNavigations)
      throw new RedditNavigationBudget("Reddit page-open budget reached");
    const wait = nextNavigation - performance.now();
    if (wait > 0) await setTimeout(wait, undefined, { signal: input.signal });
    input.signal.throwIfAborted();
    navigations++;
    nextNavigation = performance.now() + MIN_NAVIGATION_GAP_MS;
    input.onNavigation();
  };

  async function read<T>(
    target: PromotionTarget,
    task: (tab: PromotionBrowser) => Promise<T>,
    owned: boolean,
  ) {
    const run = async () => {
      const tab = new PromotionBrowser(
        target,
        promotionRequiredEnv("PINCHTAB_BASE_URL"),
        promotionRequiredEnv("PINCHTAB_TOKEN"),
        {
          signal: input.signal,
          captureChallenges: false,
          beforeRedditNavigation,
          redditAccount: {
            failure: async (failure) => {
              await recordRedditAccountFailure(input.store, failure);
            },
            success: () => Promise.resolve(),
          },
        },
      );
      try {
        const result = await task(tab);
        await recordRedditAccountSuccess(input.store);
        return result;
      } finally {
        await tab.close().catch((error: unknown) => {
          input.onCleanupFailure(error);
        });
      }
    };
    return owned
      ? await run()
      : await withRedditPromotionAccount(input.store, input.occurrenceId, run);
  }

  return {
    beforeRedditNavigation,
    remainingNavigations: () => input.maxNavigations - navigations,
    readListing: async ({
      subreddit,
      after,
      limit,
    }: {
      subreddit: string;
      after: string | null;
      limit: number;
    }) =>
      await read(
        communityTarget(subreddit),
        async (tab) => {
          const url = after ?? `https://old.reddit.com/r/${subreddit}/new/`;
          validateRedditFeedPageUrl(url, subreddit);
          await tab.open(url);
          const page = await tab.readRedditFeedPage({
            subreddit,
            limit,
            account: REDDIT_OUTREACH_ACCOUNT,
          });
          await input.dataset.listing(subreddit, page.posts);
          return page;
        },
        false,
      ),
    readRules: async (subreddit: string, owned = false) => {
      const target = communityTarget(subreddit);
      return await read(
        target,
        async (tab) => {
          await tab.open(target.rulesUrl);
          return await tab.readRedditRules({
            subreddit,
            account: REDDIT_OUTREACH_ACCOUNT,
          });
        },
        owned,
      );
    },
    readThread: async (post: RedditListingPost, owned = false) => {
      const url = new URL(post.url);
      url.hostname = "old.reddit.com";
      return await read(
        redditReplyTarget(post),
        async (tab) => {
          await tab.open(url.href);
          const observation = await tab.readRedditThreadSnapshot({
            account: REDDIT_OUTREACH_ACCOUNT,
          });
          const thread = observation.post;
          if (
            thread.loggedInUsername?.toLowerCase() !== REDDIT_OUTREACH_ACCOUNT
          )
            throw new RedditBrowserReadError(
              "identity",
              "Reddit browser is not signed in as the configured outreach account",
            );
          await input.dataset.thread(observation);
          return thread;
        },
        owned,
      );
    },
  };
}

function communityTarget(subreddit: string) {
  if (!/^\w{3,21}$/u.test(subreddit))
    throw new Error("Invalid Reddit outreach community");
  const url = `https://old.reddit.com/r/${subreddit}/`;
  return PromotionTargetSchema.parse({
    id: `reddit-discovery-${subreddit.toLowerCase().replaceAll("_", "-")}`,
    name: `Reddit discovery in r/${subreddit}`,
    url,
    rulesUrl: `${url}about/rules/`,
    account: "reddit",
    hosts: ["old.reddit.com", "www.reddit.com"],
    action: "inspect",
    content: "reddit-minecraftserver",
    minimumIntervalSeconds: 0,
    notes: "Read the assigned community listings and rules.",
  });
}
