import type { PromotionOverview } from "@shepherdjerred/ops-model/promotion/model.ts";
import type {
  RedditOutreachOverview,
  RedditOutreachPostPage,
  RedditOutreachRun,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";

const recorded: RedditOutreachRun = {
  id: "the-storm-reddit-outreach/recorded",
  at: "2026-11-21T18:15:42Z",
  elapsedMs: 42_000,
  status: "recorded",
  stopReason: "exhausted",
  inspected: 452,
  assessed: 25,
  cached: 2,
  metrics: {
    draftsPrepared: 2,
    reasons: {
      "already-handled": 5,
      "rules-exclude-replies": 4,
      "intent-unconfirmed": 10,
      "score-too-low": 15,
      "publish-blocked": 1,
      "publish-verified": 1,
    },
  },
  verifiedReceipts: [
    "https://www.reddit.com/r/MinecraftServer/comments/abc123/server_request/def456/",
  ],
  unresolvedReplies: 1,
  failureCategory: null,
};

export function redditOutreachPostsFixture(
  runId: string | null,
  offset: string | null,
): RedditOutreachPostPage {
  if (runId !== recorded.id) return { status: "unavailable" };
  if (offset === "50") {
    return {
      status: "available",
      posts: [
        {
          id: "ghi789",
          subreddit: "MinecraftServerFinder",
          title: "My new survival server is open",
          url: "https://www.reddit.com/r/MinecraftServerFinder/comments/ghi789/",
          score: null,
          result: "skipped",
          reason: "listing-ineligible",
        },
      ],
      nextOffset: null,
    };
  }
  return {
    status: "available",
    posts: [
      {
        id: "abc123",
        subreddit: "MinecraftServer",
        title: "Looking for a survival server near my region",
        url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/",
        score: 0.74,
        result: "no-match",
        reason: "The server location could not be confirmed.",
      },
    ],
    nextOffset: 50,
  };
}

export const redditOutreachFixture: Extract<
  RedditOutreachOverview,
  { status: "available" }
> = {
  status: "available",
  schedule: {
    state: "active",
    lastRunAt: "2026-11-21T18:45:00Z",
    nextRunAt: "2026-11-21T19:00:00Z",
  },
  publishing: "enabled",
  account: { hold: "challenge", retryAt: "2026-11-21T19:15:00Z" },
  today: {
    day: "2026-11-21",
    inspected: 1282,
    assessed: 34,
    cached: 2,
    draftsPrepared: 2,
    verifiedReplies: 1,
    unresolvedReplies: 1,
    remainingSlots: 8,
  },
  runs: [
    {
      id: "the-storm-reddit-outreach/failed",
      at: "2026-11-21T18:45:00Z",
      elapsedMs: 7000,
      status: "failed",
      stopReason: null,
      inspected: null,
      assessed: null,
      cached: null,
      metrics: null,
      verifiedReceipts: [],
      unresolvedReplies: 0,
      failureCategory: "workflow",
    },
    {
      ...recorded,
      id: "the-storm-reddit-outreach/rate-limited",
      at: "2026-11-21T18:30:22Z",
      elapsedMs: 22_000,
      stopReason: "decisions-rate-limit",
      deferUntil: "2026-11-21T19:15:00Z",
      inspected: 830,
      assessed: 9,
      cached: 0,
      metrics: { draftsPrepared: 0, reasons: { "listing-ineligible": 328 } },
      coverage: [
        {
          subreddit: "MinecraftServer",
          since: "2026-11-21T18:15:00Z",
          until: "2026-11-21T18:30:00Z",
          found: 12,
          scored: 9,
          skipped: 1,
          pending: 2,
          complete: false,
        },
      ],
      verifiedReceipts: [],
      unresolvedReplies: 0,
      failureCategory: "decisions",
    },
    {
      ...recorded,
      coverage: [
        {
          subreddit: "MinecraftServer",
          since: "2026-11-21T18:00:00Z",
          until: "2026-11-21T18:15:00Z",
          found: 26,
          scored: 20,
          skipped: 6,
          pending: 0,
          complete: true,
        },
        {
          subreddit: "MinecraftServerFinder",
          since: "2026-11-21T18:00:00Z",
          until: "2026-11-21T18:15:00Z",
          found: 12,
          scored: 7,
          skipped: 5,
          pending: 0,
          complete: true,
        },
      ],
    },
    {
      ...recorded,
      id: "the-storm-reddit-outreach/older-audit",
      at: "2026-11-21T06:00:42Z",
      inspected: 127,
      assessed: 4,
      cached: 0,
      metrics: null,
      verifiedReceipts: [],
      unresolvedReplies: 0,
    },
  ],
};

export const promotionFixture: PromotionOverview = {
  version: 1,
  readAt: "2026-11-21T18:47:13Z",
  scheduling: "scheduled",
  lastRun: {
    batchId: null,
    scope: null,
    startedAt: null,
    finishedAt: null,
    status: "not_run",
    followUpCount: 0,
    counts: {
      done: 0,
      notDue: 0,
      disabled: 0,
      errors: 0,
      interventions: 0,
      running: 0,
      queued: 0,
      notRun: 0,
    },
    rows: [],
  },
  sources: [],
  batches: [],
  spend: {
    day: "2026-11-21",
    aiUsd: 0,
    captchaUsd: 0,
    pendingCaptchaUsd: 0,
    unknownAi: 0,
    allocatedAiUsd: 0,
    unallocatedUnknownAi: 0,
  },
  redditOutreach: redditOutreachFixture,
};
