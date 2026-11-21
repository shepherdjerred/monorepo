import { Context } from "@temporalio/activity";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { promotionStore } from "#activities/promotion/store.ts";
import { promotionRequiredEnv } from "#activities/promotion/transport.ts";
import {
  readRedditPromotionAccount,
  recordRedditAccountFailure,
  restoreRedditPromotionAccount,
} from "./ownership.ts";

/** An operator repairs the browser session before calling this read-only verification. */
export async function restoreRedditPromotionAccountActivity(input: {
  reason: string;
}) {
  const context = Context.current();
  const execution = context.info.workflowExecution;
  if (execution === undefined || context.info.namespace !== "prod")
    throw new Error(
      "Reddit account restoration requires a production Workflow",
    );
  const store = promotionStore();
  await restoreRedditPromotionAccount({
    store,
    owner: `${execution.workflowId}/${execution.runId}`,
    reason: input.reason,
    verify: async () => {
      const browser = new PromotionBrowser(
        promotionTarget("reddit-minecraftserver"),
        promotionRequiredEnv("PINCHTAB_BASE_URL"),
        promotionRequiredEnv("PINCHTAB_TOKEN"),
        {
          signal: context.cancellationSignal,
          captureChallenges: false,
          redditAccount: {
            failure: async (failure) => {
              await recordRedditAccountFailure(store, failure);
            },
            success: () => Promise.resolve(),
          },
        },
      );
      try {
        await browser.open("https://old.reddit.com/r/MinecraftServer/new/");
        await browser.readRedditFeedPage({
          subreddit: "MinecraftServer",
          limit: 1,
          account: "the_storm_mc",
        });
      } finally {
        await browser.close();
      }
    },
  });
  return await readRedditPromotionAccount(store);
}
