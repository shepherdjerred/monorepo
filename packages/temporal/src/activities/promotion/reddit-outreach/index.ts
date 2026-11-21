import { z } from "zod/v4";
import { PromotionTargetSchema } from "#shared/promotion/model.ts";
import { runBudgetedPromotion } from "#activities/promotion/control/budgeted-agent.ts";
import { promotionSpendDay } from "#activities/promotion/control/budget.ts";
import {
  readPromotionState,
  assertPromotionOwnership,
  updatePromotionState,
  type PromotionStore,
} from "#activities/promotion/store.ts";
import {
  RedditRequestPostSchema,
  assertRedditPostIdentity,
  type RedditListingPost,
  type RedditRequestPost,
} from "#activities/promotion/reddit-discovery/model.ts";
import {
  claimRedditReply,
  finishRedditReply,
  readRedditReplyRecord,
  reserveRedditReplyAllowance,
} from "./ledger.ts";
import { RedditAccountBusy, withRedditPromotionAccount } from "./ownership.ts";

export type RedditReplyOutcome = {
  postId: string;
  status: "verified" | "blocked" | "duplicate" | "deferred";
  summary: string;
  receiptUrl?: string;
};

export function redditReplyTarget(post: RedditListingPost) {
  assertRedditPostIdentity(post);
  return PromotionTargetSchema.parse({
    id: `reddit-outreach-${post.id}`,
    name: `Reddit request ${post.id}`,
    url: post.url,
    rulesUrl: `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}/`,
    hosts: ["old.reddit.com", "www.reddit.com", "reddit.com"],
    account: "reddit",
    action: "reply",
    content: "reddit-minecraftserver",
    minimumIntervalSeconds: 0,
    notes:
      "One initial top-level reply to this assessed server-seeking post, as the_storm_mc. Never send a follow-up or DM.",
  });
}

/** Compare the entire assessed request again immediately before composer mutations. */
export function assertFreshRedditRequest(
  assessed: RedditRequestPost,
  observed: RedditRequestPost,
) {
  assertRedditPostIdentity(observed);
  if (observed.loggedInUsername?.toLowerCase() !== "the_storm_mc")
    throw new Error(
      "Reddit outreach requires the logged-in account the_storm_mc",
    );
  if (
    observed.author.toLowerCase() === "the_storm_mc" ||
    observed.ownReplyIds.length > 0
  )
    throw new Error(
      "Reddit thread is owned by, or already has a reply from, the_storm_mc",
    );
  if (!observed.commentsComplete)
    throw new Error(
      "Reddit thread history is incomplete; cannot exclude an existing reply",
    );
  if (observed.removed || observed.locked || observed.archived)
    throw new Error("Reddit request is no longer available for replies");
  if (
    observed.id !== assessed.id ||
    observed.subreddit.toLowerCase() !== assessed.subreddit.toLowerCase() ||
    observed.author !== assessed.author ||
    observed.title !== assessed.title ||
    observed.body !== assessed.body
  )
    throw new Error("Reddit request changed after relevance assessment");
}

type ExecuteInput = {
  post: RedditRequestPost;
  replyText: string;
  relevanceReason: string;
  occurrenceId: string;
  settings: {
    maxRepliesPerDay: number;
    maxPostAgeHours: number;
    model: string;
    dailySpendUsd: number;
  };
  store: PromotionStore;
  enabled: () => Promise<boolean>;
  inspect: () => Promise<RedditRequestPost>;
  validate?: () => Promise<boolean>;
  beforeRedditNavigation?: (() => Promise<void>) | undefined;
  signal?: AbortSignal;
  run?: typeof runBudgetedPromotion;
  now?: () => Date;
};

export async function executeRedditOutreachReply(
  input: ExecuteInput,
): Promise<RedditReplyOutcome> {
  const post = RedditRequestPostSchema.parse(input.post);
  const replyText = z.string().trim().min(1).max(1000).parse(input.replyText);
  const now = input.now ?? (() => new Date());
  const rulesStillMatch = input.validate ?? (() => Promise.resolve(true));
  const assertRulesStillMatch = async () => {
    if (!(await rulesStillMatch()))
      throw new Error("Reddit community rules changed before publishing");
  };
  const outcome = (
    status: RedditReplyOutcome["status"],
    summary: string,
  ): RedditReplyOutcome => ({ postId: post.id, status, summary });
  assertRedditPostIdentity(post);
  if (!(await input.enabled()))
    return outcome("deferred", "Reddit outreach is disabled");
  if ((await readRedditReplyRecord(input.store, post.id)) !== undefined)
    return outcome(
      "duplicate",
      "This post already has a durable reply disposition",
    );
  try {
    return await withRedditPromotionAccount(
      input.store,
      input.occurrenceId,
      async () => {
        if (!(await rulesStillMatch()))
          return outcome(
            "deferred",
            "Reddit community rules changed before execution",
          );
        assertFreshRedditRequest(
          post,
          RedditRequestPostSchema.parse(await input.inspect()),
        );
        const releaseAllowance = await reserveRedditReplyAllowance(
          input.store,
          post.id,
          input.settings.maxRepliesPerDay,
          now(),
        );
        if (releaseAllowance === null)
          return outcome(
            "deferred",
            "Pacific daily Reddit reply limit reached",
          );
        if (
          !(await claimRedditReply(input.store, input.occurrenceId, now(), {
            post,
            replyText,
            relevanceReason: input.relevanceReason,
          }))
        ) {
          await releaseAllowance();
          return outcome(
            "duplicate",
            "This post was claimed by another execution",
          );
        }
        const target = redditReplyTarget(post);
        const releases = [releaseAllowance];
        const reservedDays = new Set([promotionSpendDay(now())]);
        let state = await updatePromotionState(
          input.store,
          target.id,
          (current) => {
            if (current.lock !== null || current.attempts.length > 0)
              throw new Error(
                "Reddit post has an existing promotion execution",
              );
            return {
              ...current,
              lock: {
                occurrenceId: input.occurrenceId,
                acquiredAt: now().toISOString(),
              },
              lastOccurrenceId: input.occurrenceId,
            };
          },
        );
        const beforeMutation = async () => {
          const current = now();
          const age = current.getTime() - Date.parse(post.createdAt);
          if (age < 0 || age > input.settings.maxPostAgeHours * 3_600_000)
            throw new Error(
              "Reddit request is outside the configured freshness window",
            );
          await assertRulesStillMatch();
          assertFreshRedditRequest(
            post,
            RedditRequestPostSchema.parse(await input.inspect()),
          );
          const day = promotionSpendDay(current);
          if (!reservedDays.has(day)) {
            const release = await reserveRedditReplyAllowance(
              input.store,
              post.id,
              input.settings.maxRepliesPerDay,
              current,
            );
            if (release === null)
              throw new Error(
                "Pacific daily Reddit reply limit reached before submission",
              );
            releases.push(release);
            reservedDays.add(day);
          }
        };
        let summary: string;
        try {
          const result = await (input.run ?? runBudgetedPromotion)(
            {
              target,
              state,
              store: input.store,
              mode: "run",
              occurrenceId: input.occurrenceId,
              replyAssignment: {
                content: replyText,
                enabled: input.enabled,
                beforeMutation,
                signal: input.signal,
                beforeRedditNavigation: input.beforeRedditNavigation,
              },
            },
            {
              model: input.settings.model,
              dailySpendUsd: input.settings.dailySpendUsd,
            },
          );
          summary = result.result.summary;
        } catch (error) {
          summary =
            error instanceof Error
              ? error.message
              : "Reddit reply execution failed";
        }
        state = await readPromotionState(input.store, target.id);
        const attempt = state.attempts.find(
          (item) => item.occurrenceId === input.occurrenceId,
        );
        const verified = attempt?.status === "verified";
        const uncertain = attempt?.status === "uncertain";
        const receiptUrl = verified ? attempt.receiptUrl : null;
        await finishRedditReply(input.store, {
          postId: post.id,
          occurrenceId: input.occurrenceId,
          status: verified ? "verified" : uncertain ? "uncertain" : "blocked",
          completedAt: now().toISOString(),
          summary,
          receiptUrl,
        });
        await updatePromotionState(input.store, target.id, (current) => {
          assertPromotionOwnership(current, input.occurrenceId);
          return {
            ...current,
            lock: uncertain ? current.lock : null,
            blockedReason: verified ? null : summary,
          };
        });
        if (attempt === undefined || attempt.status === "no-action")
          for (const release of releases) await release();
        return {
          ...outcome(verified ? "verified" : "blocked", summary),
          ...(receiptUrl === null ? {} : { receiptUrl }),
        };
      },
    );
  } catch (error) {
    if (error instanceof RedditAccountBusy)
      return outcome("deferred", error.message);
    throw error;
  }
}
