import { Context } from "@temporalio/activity";
import type {
  RedditOutreachCoverage,
  RedditOutreachMetrics,
  RedditOutreachPost,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import {
  redditOutreachConfig,
  type RedditOutreachSettings,
} from "#config/reddit-outreach.ts";
import { promotionConfig } from "#config/promotion.ts";
import { promotionStore, type PromotionStore } from "./store.ts";
import { eligibleRedditRequest } from "./reddit-discovery/index.ts";
import {
  RedditBrowserReadError,
  type RedditFeedPost,
} from "./reddit-discovery/browser-reader.ts";
import {
  qualifiesForRedditDraft,
  type RedditQualification,
} from "./reddit-discovery/decisions.ts";
import { runIncrementalRedditDiscovery } from "./reddit-discovery/incremental.ts";
import type { RedditRequestPost } from "./reddit-discovery/model.ts";
import { screenRedditBatch } from "./reddit-discovery/screening.ts";
import { executeRedditOutreachReply } from "./reddit-outreach/index.ts";
import {
  readRedditReplyRecord,
  remainingRedditReplyAllowance,
} from "./reddit-outreach/ledger.ts";
import {
  createRedditOutreachBrowser,
  RedditNavigationBudget,
  REDDIT_OUTREACH_ACCOUNT,
} from "./reddit-outreach/browser-session.ts";
import {
  recordSweep,
  type SweepSummary,
} from "./reddit-outreach/sweep-audit.ts";
import {
  countDecisionRejections,
  countReason,
  draftCandidate,
} from "./reddit-outreach/sweep-evaluation.ts";
import {
  readRedditDecisionsBackoff,
  recordSweepFailure,
  recordSweepStop,
} from "./reddit-outreach/sweep-stop.ts";

const OUTREACH_SWEEP_BUDGET_MS = 13 * 60_000;
// Initial rules/thread checks, composer open, two rules/thread rechecks, receipt.
const MIN_REPLY_PAGE_OPENS = 8;
type ActiveSweepSummary = SweepSummary & { metrics: RedditOutreachMetrics };
type SweepInput = {
  settings: RedditOutreachSettings;
  config: { model: string; dailySpendUsd: number };
  store: PromotionStore;
  signal: AbortSignal;
  summary: ActiveSweepSummary;
  posts: Map<string, RedditOutreachPost>;
};
type SweepServices = SweepInput & {
  browser: ReturnType<typeof createRedditOutreachBrowser>;
};

export async function sweepRedditOutreach(input: { preview?: boolean } = {}) {
  const started = performance.now();
  const context = Context.current();
  const { workflowExecution, namespace } = context.info;
  if (workflowExecution === undefined)
    throw new Error("Reddit outreach requires a Workflow-owned Activity");
  if (namespace !== "prod" && input.preview !== true)
    throw new Error("Reddit publishing requires the production namespace");
  const { workflowId, runId } = workflowExecution;
  const summary: ActiveSweepSummary = {
    occurrenceId: `${workflowId}/${runId}`,
    completedAt: new Date().toISOString(),
    preview: input.preview === true,
    inspected: 0,
    listingPages: 0,
    threadReads: 0,
    pageOpens: 0,
    elapsedMs: 0,
    assessed: 0,
    cached: 0,
    metrics: { draftsPrepared: 0, reasons: {} },
    failures: [],
    replies: [],
    drafts: [],
  };
  const settings = await redditOutreachConfig();
  const config = await promotionConfig();
  const disabled =
    !settings.enabled ||
    !config.available ||
    settings.maxRepliesPerSweep === 0 ||
    settings.maxRepliesPerDay === 0;
  if (disabled) {
    summary.stopReason = "disabled";
    finishSweepTiming(summary, started);
    if (!summary.preview) {
      try {
        await recordSweep(promotionStore(), summary);
      } catch {
        context.log.warn("Unable to record disabled Reddit outreach sweep");
      }
    }
    return summary;
  }
  const store = promotionStore();
  const posts = new Map<string, RedditOutreachPost>();
  const signal = AbortSignal.any([
    context.cancellationSignal,
    AbortSignal.timeout(OUTREACH_SWEEP_BUDGET_MS),
  ]);
  const beat = setInterval(() => {
    context.heartbeat({
      phase: "reddit-outreach",
      inspected: summary.inspected,
    });
  }, 15_000);
  try {
    await runRedditOutreachSweep({
      settings,
      config,
      store,
      signal,
      summary,
      posts,
    });
  } catch (error) {
    await recordSweepStop(store, summary, signal, error);
  } finally {
    clearInterval(beat);
  }
  finishSweepTiming(summary, started);
  await recordSweep(store, summary, [...posts.values()]);
  return summary;
}

function finishSweepTiming(summary: SweepSummary, started: number) {
  summary.elapsedMs = Math.round(performance.now() - started);
  summary.completedAt = new Date().toISOString();
}

export async function runRedditOutreachSweep(input: SweepInput) {
  const { store, settings, signal, summary } = input;
  if (!summary.preview && Context.current().info.namespace !== "prod")
    throw new Error("Reddit publishing requires the production namespace");
  const now = Date.now();
  const backoff = await readRedditDecisionsBackoff(store);
  if (backoff !== undefined && Date.parse(backoff.value) > now) {
    summary.stopReason = "decisions-rate-limit";
    summary.deferUntil = backoff.value;
    return;
  }
  const remaining = await remainingRedditReplyAllowance(
    store,
    settings.maxRepliesPerDay,
    new Date(now),
  );
  const replyLimit = Math.min(settings.maxRepliesPerSweep, remaining);
  if (replyLimit === 0) {
    summary.stopReason = "daily-limit";
    return;
  }
  const browser = createRedditOutreachBrowser({
    store,
    signal,
    occurrenceId: summary.occurrenceId,
    maxNavigations: settings.maxRedditNavigationsPerSweep,
    onNavigation: () => {
      summary.pageOpens = (summary.pageOpens ?? 0) + 1;
    },
    onCleanupFailure: (error) => {
      recordSweepFailure(summary, "browser cleanup", error, "browser");
    },
  });
  const services = { ...input, browser };
  const rules = new Map<string, string>();
  const coverage = new Map<string, RedditOutreachCoverage>();
  const result = await runIncrementalRedditDiscovery<RedditFeedPost>({
    store,
    signal,
    now,
    preview: summary.preview,
    subreddits: rotateCommunities(settings.subreddits, now),
    maxAgeHours: settings.maxPostAgeHours,
    postLimit: settings.maxPostsPerSweep,
    pageLimit: settings.maxListingPagesPerSweep,
    isPinned: (post) => post.sticky,
    isExpiredCursor: (error) =>
      error instanceof RedditBrowserReadError && error.kind === "cursor",
    readPage: async (page) => {
      summary.listingPages = (summary.listingPages ?? 0) + 1;
      const read = await browser.readListing(page);
      return { posts: read.posts, after: read.next };
    },
    onInspected: () => {
      summary.inspected++;
    },
    onCoverage: (row) => {
      coverage.set(row.subreddit, row);
      summary.coverage = [...coverage.values()];
    },
    onPost: ({ id, subreddit, title }) => {
      input.posts.set(id, {
        id,
        subreddit,
        title,
        url: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
        score: null,
        result: "pending",
        reason: null,
      });
    },
    shouldStop: () => {
      if (usedReplySlots(summary) >= replyLimit) return "reply-limit";
      return browser.remainingNavigations() === 0
        ? "browser-budget"
        : undefined;
    },
    process: async ({ subreddit, posts, settle }) =>
      await processPage(services, {
        subreddit,
        posts,
        settle,
        rules,
        replyLimit,
      }),
  });
  summary.stopReason = result.stopReason;
}

function rotateCommunities(subreddits: readonly string[], now: number) {
  const offset = Math.floor(now / (15 * 60_000)) % subreddits.length;
  return [...subreddits.slice(offset), ...subreddits.slice(0, offset)];
}

function canScreen(post: RedditFeedPost) {
  return (
    !post.removed &&
    !post.archived &&
    !post.locked &&
    !post.over18 &&
    !post.sticky &&
    post.author.toLowerCase() !== REDDIT_OUTREACH_ACCOUNT &&
    post.author !== "[deleted]" &&
    !/^advertising$/i.test(post.flair ?? "")
  );
}

async function listingRejection(store: PromotionStore, post: RedditFeedPost) {
  if (!canScreen(post)) return "listing-ineligible";
  return (await readRedditReplyRecord(store, post.id)) === undefined
    ? undefined
    : "already-handled";
}

function threadRejection(
  post: RedditRequestPost,
  listing: RedditFeedPost,
  maxPostAgeHours: number,
) {
  if (
    post.id !== listing.id ||
    post.subreddit.toLowerCase() !== listing.subreddit.toLowerCase() ||
    post.author !== listing.author ||
    Date.parse(post.createdAt) !== Date.parse(listing.createdAt)
  )
    return "thread-ineligible";
  if (
    eligibleRedditRequest(post, {
      now: Date.now(),
      maxPostAgeHours,
      account: REDDIT_OUTREACH_ACCOUNT,
      alreadyHandled: new Set(),
    })
  )
    return;
  return post.ownReplyIds.length > 0 ? "already-handled" : "thread-ineligible";
}

function seekerHint(post: RedditFeedPost) {
  return /\b(?:looking for|seeking|lf|iso|recommend(?:ation|ations)?)\b/i.test(
    `${post.flair ?? ""} ${post.title}`,
  );
}

function permitsRuleReview(rules: string) {
  return (
    rules.trim() !== "" &&
    !/don['’]t advertise on another community member['’]?s post/i.test(rules)
  );
}

function usedReplySlots(summary: SweepSummary) {
  return (
    summary.drafts.length +
    summary.replies.filter(
      ({ status }) => status === "verified" || status === "blocked",
    ).length
  );
}

async function processPage(
  services: SweepServices,
  input: {
    subreddit: string;
    posts: readonly RedditFeedPost[];
    settle: (
      ids: readonly string[],
      disposition: "scored" | "skipped",
    ) => Promise<void>;
    rules: Map<string, string>;
    replyLimit: number;
  },
): Promise<{ stopReason?: string }> {
  const { summary, settings, signal, store, browser } = services;
  const posts = input.posts.toSorted(
    (a, b) => Number(seekerHint(b)) - Number(seekerHint(a)),
  );
  for (const post of posts) {
    signal.throwIfAborted();
    if (usedReplySlots(summary) >= input.replyLimit)
      return { stopReason: "reply-limit" };
    const audit = services.posts.get(post.id);
    if (audit === undefined) throw new Error("Missing Reddit post audit");
    const skipReason = await listingRejection(store, post);
    if (skipReason !== undefined) {
      countReason(summary, skipReason);
      audit.result = "skipped";
      audit.reason = skipReason;
      await input.settle([post.id], "skipped");
      continue;
    }
    const threadReads = summary.threadReads ?? 0;
    if (threadReads >= settings.maxThreadReadsPerSweep)
      return { stopReason: "thread-budget" };
    let rules = input.rules.get(input.subreddit);
    if (rules === undefined) {
      rules = await browser.readRules(input.subreddit);
      input.rules.set(input.subreddit, rules);
    }
    if (!permitsRuleReview(rules)) {
      countReason(summary, "rules-exclude-replies");
      audit.result = "skipped";
      audit.reason = "rules-exclude-replies";
      await input.settle([post.id], "skipped");
      continue;
    }
    summary.threadReads = threadReads + 1;
    const disposition = await assessThread(services, post, rules, audit);
    if (disposition === "deferred") return { stopReason: "publish-deferred" };
    await input.settle([post.id], disposition);
  }
  return {};
}

async function assessThread(
  services: SweepServices,
  listing: RedditFeedPost,
  rules: string,
  audit: RedditOutreachPost,
): Promise<"scored" | "skipped" | "deferred"> {
  const { browser, store, signal, config, settings, summary } = services;
  const post = await browser.readThread(listing);
  const rejection = threadRejection(post, listing, settings.maxPostAgeHours);
  if (rejection !== undefined) {
    countReason(summary, rejection);
    audit.result = "skipped";
    audit.reason = rejection;
    return "skipped";
  }
  const assessment = await screenRedditBatch({
    items: [{ post, rules }],
    store,
    signal,
    reservationId: `${summary.occurrenceId}/decisions/${post.id}`,
    dailySpendUsd: config.dailySpendUsd,
    cacheScope: "thread",
  });
  summary.assessed += assessment.assessed;
  summary.cached += assessment.cached;
  const qualification = assessment.matches[0]?.qualification;
  audit.score = qualification?.judgeScore ?? null;
  audit.reason = qualification?.reason ?? "decision-declined";
  if (qualification === undefined || !qualifiesForRedditDraft(qualification)) {
    countDecisionRejections(summary, qualification);
    audit.result = "no-match";
    return "scored";
  }
  const reply = await draftCandidate({
    store,
    signal,
    config,
    occurrenceId: summary.occurrenceId,
    post,
    rules,
    qualification,
  });
  if (reply === null) {
    countReason(summary, "draft-rejected");
    audit.result = "draft-rejected";
    audit.reason = "draft-rejected";
    return "scored";
  }
  summary.metrics.draftsPrepared++;
  if (summary.preview) {
    audit.result = "draft-ready";
    summary.drafts.push({
      postId: post.id,
      reply,
      matchProbability: qualification.judgeScore,
    });
    return "scored";
  }
  const result = await publishCandidate(services, {
    post,
    reply,
    qualification,
    rules,
  });
  audit.result = `publish-${result}`;
  audit.reason = audit.result;
  return result === "deferred" ? "deferred" : "scored";
}

async function publishCandidate(
  services: SweepServices,
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
  const result = await executeRedditOutreachReply({
    post: input.post,
    replyText: input.reply,
    relevanceReason: input.qualification.reason,
    occurrenceId: `${summary.occurrenceId}/reply/${input.post.id}`,
    settings: { ...settings, ...config },
    store,
    signal,
    inspect: async () => await browser.readThread(input.post, true),
    beforeRedditNavigation: browser.beforeRedditNavigation,
    validate: async () =>
      (await browser.readRules(input.post.subreddit, true)) === input.rules,
    enabled: async () => enabledBeforePublish(services, input.post),
  });
  summary.replies.push(result);
  countReason(summary, `publish-${result.status}`);
  return result.status;
}

async function enabledBeforePublish(
  { signal, settings }: SweepServices,
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

export type RedditOutreachActivities = {
  sweepRedditOutreach: typeof sweepRedditOutreach;
};
