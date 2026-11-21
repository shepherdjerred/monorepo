import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promotionConfig } from "#config/promotion.ts";
import {
  DEFAULT_REDDIT_OUTREACH_SETTINGS,
  redditOutreachConfig,
} from "#config/reddit-outreach.ts";
import { promotionSpendDay } from "./control/budget.ts";
import {
  RedditBrowserReadError,
  type RedditFeedPost,
} from "./reddit-discovery/browser-reader.ts";
import type { RedditQualification } from "./reddit-discovery/decisions.ts";
import type {
  RedditListingPost,
  RedditRequestPost,
} from "./reddit-discovery/model.ts";
import { draftRedditInvite } from "./reddit-discovery/relevance.ts";
import { screenRedditBatch } from "./reddit-discovery/screening.ts";
import { createRedditOutreachBrowser } from "./reddit-outreach/browser-session.ts";
import { executeRedditOutreachReply } from "./reddit-outreach/index.ts";
import { claimRedditReply } from "./reddit-outreach/ledger.ts";
import {
  readRedditSweep,
  readRedditSweepDay,
  recordSweep,
} from "./reddit-outreach/sweep-audit.ts";
import { sweepRedditOutreach } from "./reddit-sweep.ts";
import { promotionStore } from "./store.ts";
import { memoryPromotionStore } from "./test-support.ts";

vi.mock("#config/promotion.ts", { spy: true });
vi.mock("#config/reddit-outreach.ts", { spy: true });
vi.mock("./store.ts", { spy: true });
vi.mock("./reddit-outreach/browser-session.ts", { spy: true });
vi.mock("./reddit-outreach/index.ts", { spy: true });
vi.mock("./reddit-discovery/relevance.ts", { spy: true });
vi.mock("./reddit-discovery/screening.ts", { spy: true });

const now = new Date("2026-11-20T03:00:00.000Z");
const subreddit = "MinecraftServer";
const workflowId = "storm-reddit-outreach";
const runId = "fixture-run";
const qualification: RedditQualification = {
  decision: "match",
  judgeScore: 0.9,
  explicitlySeekingServer: true,
  communityAllowsReply: true,
  hardConstraintsSatisfied: true,
  reason: "Private assessment detail",
};

function listing(id: string): RedditFeedPost {
  return {
    id,
    subreddit,
    author: "seeking-player",
    title: "Looking for a Minecraft server",
    url: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    flair: null,
    sticky: false,
    removed: false,
    locked: false,
    archived: false,
    over18: false,
  };
}

function thread(post: RedditListingPost): RedditRequestPost {
  return {
    id: post.id,
    subreddit: post.subreddit,
    url: post.url,
    author: post.author,
    title: post.title,
    createdAt: post.createdAt,
    removed: false,
    archived: false,
    locked: false,
    body: "Private request body",
    ownReplyIds: post.id === "alreadyreplied" ? ["existingcomment"] : [],
    commentsComplete: post.id !== "incomplete",
    loggedInUsername: "the_storm_mc",
  };
}

function runSweep(preview = false) {
  return new MockActivityEnvironment({
    namespace: "prod",
    workflowExecution: { workflowId, runId },
  }).run<
    Parameters<typeof sweepRedditOutreach>,
    Awaited<ReturnType<typeof sweepRedditOutreach>>,
    typeof sweepRedditOutreach
  >(sweepRedditOutreach, { preview });
}

function browserFixture(
  posts: RedditFeedPost[] = [],
  rules = "Replies welcome",
) {
  const browser = {
    beforeRedditNavigation: vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    remainingNavigations: () => 60,
    readListing: vi
      .fn<() => Promise<{ posts: RedditFeedPost[]; next: string | null }>>()
      .mockResolvedValue({ posts, next: null }),
    readRules: vi.fn<() => Promise<string>>().mockResolvedValue(rules),
    readThread: vi.fn(async (post: RedditListingPost) => thread(post)),
  };
  vi.mocked(createRedditOutreachBrowser).mockReturnValue(browser);
  return browser;
}

beforeEach(() => {
  vi.setSystemTime(now);
  browserFixture();
  vi.mocked(executeRedditOutreachReply).mockRejectedValue(
    new Error("Unexpected publish attempt"),
  );
  vi.mocked(promotionStore).mockReturnValue(memoryPromotionStore());
  vi.mocked(promotionConfig).mockResolvedValue({
    enabled: true,
    available: true,
    enabledTargets: [],
    model: "gpt-6-luna",
    maxSteps: 1,
    timeoutMinutes: 1,
    monthlySolverUsd: 0,
    dailySpendUsd: 5,
  });
  vi.mocked(redditOutreachConfig).mockResolvedValue({
    ...DEFAULT_REDDIT_OUTREACH_SETTINGS,
    subreddits: [subreddit],
    enabled: true,
    available: true,
    provenance: { enabled: "default", settings: "default" },
  });
  vi.mocked(screenRedditBatch).mockImplementation(async ({ items }) => ({
    assessed: items.length,
    cached: 0,
    matches: items.map(({ post }) => ({
      post,
      qualification:
        post.id === "gates"
          ? {
              ...qualification,
              decision: "no-match",
              judgeScore: 0.8,
              explicitlySeekingServer: false,
              communityAllowsReply: false,
              hardConstraintsSatisfied: false,
            }
          : post.id === "declined"
            ? { ...qualification, decision: "no-match" }
            : qualification,
    })),
  }));
  vi.mocked(draftRedditInvite).mockImplementation(async ({ post }) => ({
    draft: {
      reply: post.id === "nodraft" ? null : "Private reply draft",
      reason: "Private draft decision",
      evidence: [],
      caveats: [],
    },
    usage: null,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("Reddit outreach sweep observability", () => {
  it("counts production drafts and overlapping typed rejection gates", async () => {
    const ineligible = { ...listing("ineligible"), locked: true };
    const posts = [
      ineligible,
      ...[
        "duplicate",
        "alreadyreplied",
        "incomplete",
        "gates",
        "declined",
        "nodraft",
        "verified",
        "blocked",
        "race",
        "deferred",
      ].map((id) => listing(id)),
    ];
    const store = promotionStore();
    await claimRedditReply(store, "earlier-claim", now, {
      post: thread(listing("duplicate")),
      replyText: "Previously prepared reply",
      relevanceReason: "Earlier assessment",
    });
    browserFixture(posts);
    const outcomes = [
      ["verified", "verified"],
      ["blocked", "blocked"],
      ["race", "duplicate"],
      ["deferred", "deferred"],
    ] as const;
    for (const [postId, status] of outcomes) {
      vi.mocked(executeRedditOutreachReply).mockResolvedValueOnce({
        postId,
        status,
        summary: "Private publisher detail",
      });
    }

    const summary = await runSweep();

    expect(summary).toMatchObject({
      inspected: 11,
      assessed: 7,
      drafts: [],
      stopReason: "publish-deferred",
      metrics: {
        draftsPrepared: 4,
        reasons: {
          "listing-ineligible": 1,
          "already-handled": 2,
          "thread-ineligible": 1,
          "intent-unconfirmed": 1,
          "permission-unconfirmed": 1,
          "requirements-unconfirmed": 1,
          "score-too-low": 1,
          "decision-declined": 1,
          "draft-rejected": 1,
          "publish-verified": 1,
          "publish-blocked": 1,
          "publish-duplicate": 1,
          "publish-deferred": 1,
        },
      },
    });
    expect(summary.replies).toHaveLength(4);
    expect(await readRedditSweepDay(store, promotionSpendDay(now))).toEqual([
      summary,
    ]);
  });

  it("records when community rules prevent thread review", async () => {
    const browser = browserFixture(
      [listing("rejected")],
      "Don’t advertise on another community member’s post.",
    );
    const summary = await runSweep();
    expect(summary.metrics).toEqual({
      draftsPrepared: 0,
      reasons: { "rules-exclude-replies": 1 },
    });
    expect(browser.readThread).not.toHaveBeenCalled();
    expect(executeRedditOutreachReply).not.toHaveBeenCalled();
  });

  it("audits a disabled production sweep without opening the browser", async () => {
    const settings = await redditOutreachConfig();
    vi.mocked(redditOutreachConfig).mockResolvedValue({
      ...settings,
      enabled: false,
    });
    const summary = await runSweep();
    expect(summary).toMatchObject({
      stopReason: "disabled",
      inspected: 0,
      metrics: { draftsPrepared: 0, reasons: {} },
    });
    expect(createRedditOutreachBrowser).not.toHaveBeenCalled();
    expect(
      await readRedditSweep(promotionStore(), `${workflowId}/${runId}`),
    ).toEqual(summary);
  });

  it("returns disabled when the audit store is unavailable", async () => {
    const settings = await redditOutreachConfig();
    vi.mocked(redditOutreachConfig).mockResolvedValue({
      ...settings,
      enabled: false,
    });
    vi.mocked(promotionStore).mockImplementationOnce(() => {
      throw new Error("Unavailable audit store");
    });
    expect(await runSweep()).toMatchObject({ stopReason: "disabled" });
    expect(createRedditOutreachBrowser).not.toHaveBeenCalled();
  });

  it("counts preview drafts in the individual audit without indexing them", async () => {
    browserFixture([listing("preview")]);
    const store = promotionStore();
    const summary = await runSweep(true);
    expect(summary.metrics.draftsPrepared).toBe(1);
    expect(summary.drafts).toHaveLength(1);
    expect(executeRedditOutreachReply).not.toHaveBeenCalled();
    expect(await readRedditSweep(store, summary.occurrenceId)).toEqual(summary);
    expect(await readRedditSweepDay(store, promotionSpendDay(now))).toEqual([]);
  });

  it("adds a safe browser failure category on a Reddit rate limit", async () => {
    browserFixture().readListing.mockRejectedValueOnce(
      new RedditBrowserReadError("rate-limit", "Private browser detail"),
    );
    const summary = await runSweep();
    expect(summary).toMatchObject({
      stopReason: "rate-limit",
      failureCategory: "browser",
      inspected: 0,
      metrics: { draftsPrepared: 0, reasons: {} },
    });
    expect(executeRedditOutreachReply).not.toHaveBeenCalled();
  });

  it("reads a legacy audit with its existing counts and no breakdown", async () => {
    const store = promotionStore();
    const summary = {
      occurrenceId: `${workflowId}/${runId}`,
      completedAt: now.toISOString(),
      preview: false,
      inspected: 5,
      assessed: 2,
      cached: 1,
      failures: [],
      replies: [],
      drafts: [],
    };
    await recordSweep(store, summary);
    expect(await readRedditSweepDay(store, promotionSpendDay(now))).toEqual([
      summary,
    ]);
    expect(await readRedditSweep(store, summary.occurrenceId)).toEqual(summary);
  });
});
