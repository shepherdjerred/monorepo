import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promotionConfig } from "#config/promotion.ts";
import {
  DEFAULT_REDDIT_OUTREACH_SETTINGS,
  redditOutreachConfig,
} from "#config/reddit-outreach.ts";
import { PromotionSnapshotBlocked } from "./access/browser-snapshot.ts";
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
import {
  REDDIT_DATASET_PREFIX,
  RedditDatasetObservationSchema,
} from "./reddit-outreach/dataset.ts";
import { executeRedditOutreachReply } from "./reddit-outreach/index.ts";
import { claimRedditReply } from "./reddit-outreach/ledger.ts";
import {
  readRedditSweep,
  readRedditSweepDay,
  readRedditSweepPostPage,
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
  reason: "Supported server requirements",
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

function runSweep(preview = false, subreddits?: string[]) {
  return new MockActivityEnvironment({
    namespace: "prod",
    workflowExecution: { workflowId, runId },
  }).run(sweepRedditOutreach, {
    preview,
    ...(subreddits === undefined ? {} : { subreddits }),
  });
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
  vi.mocked(createRedditOutreachBrowser).mockImplementation(({ dataset }) => ({
    ...browser,
    readListing: async ({ subreddit: community }) => {
      const page = await browser.readListing();
      await dataset.listing(community, page.posts);
      return page;
    },
    readThread: async (post) => {
      const observed = await browser.readThread(post);
      await dataset.thread({ post: observed, comments: [] });
      return observed;
    },
  }));
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
              judgeScore: 0.59,
              explicitlySeekingServer: false,
              communityAllowsReply: false,
              hardConstraintsSatisfied: false,
              reason: "Clear requirements are missing",
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

async function expectRecordedPostDetails(
  store: ReturnType<typeof promotionStore>,
  occurrenceId: string,
) {
  const page = await readRedditSweepPostPage(store, occurrenceId, 0);
  expect(page).toMatchObject({ status: "available", nextOffset: null });
  if (page.status !== "available") throw new Error("Expected sweep posts");
  expect(page.posts).toHaveLength(11);
  expect(page.posts.find(({ id }) => id === "gates")).toMatchObject({
    score: 0.59,
    result: "no-match",
    reason: "Clear requirements are missing",
  });
  expect(page.posts.find(({ id }) => id === "ineligible")).toMatchObject({
    title: listing("ineligible").title,
    score: null,
    result: "skipped",
    reason: "listing-ineligible",
  });
  expect(page.posts.find(({ id }) => id === "deferred")).toMatchObject({
    score: 0.9,
    result: "publish-deferred",
  });
  expect(page.posts[0]).not.toHaveProperty("author");
  expect(page.posts[0]).not.toHaveProperty("body");
}

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
      coverage: [
        {
          subreddit,
          found: 11,
          scored: 6,
          skipped: 4,
          pending: 1,
          complete: false,
        },
      ],
      metrics: {
        draftsPrepared: 4,
        reasons: {
          "listing-ineligible": 1,
          "already-handled": 2,
          "thread-ineligible": 1,
          "intent-unconfirmed": 1,
          "rules-exclude-replies": 1,
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
    expect(summary).not.toHaveProperty("posts");
    await expectRecordedPostDetails(store, summary.occurrenceId);
  });

  it("records when community rules prevent thread review", async () => {
    const pinned = { ...listing("pinned"), sticky: true };
    const browser = browserFixture(
      [pinned, listing("rejected")],
      "Don’t advertise on another community member’s post.",
    );
    const summary = await runSweep();
    expect(summary.metrics).toEqual({
      draftsPrepared: 0,
      reasons: { "listing-ineligible": 1, "rules-exclude-replies": 1 },
    });
    expect(summary.coverage).toMatchObject([
      {
        subreddit,
        found: 2,
        scored: 0,
        skipped: 2,
        pending: 0,
        complete: true,
      },
    ]);
    expect(browser.readThread).not.toHaveBeenCalled();
    expect(executeRedditOutreachReply).not.toHaveBeenCalled();
  });
});

const archiveRun = (mode: "live" | "preview") =>
  `${REDDIT_DATASET_PREFIX}/day=${promotionSpendDay(now)}/mode=${mode}/run=${encodeURIComponent(`${workflowId}/${runId}`)}`;

describe("Reddit outreach dataset persistence", () => {
  it("archives every fetched listing row before window and eligibility checks", async () => {
    const older = {
      ...listing("older"),
      createdAt: "2026-11-19T02:00:00.000Z",
      sticky: true,
    };
    const future = {
      ...listing("future"),
      createdAt: "2026-11-20T04:00:00.000Z",
    };
    const locked = { ...listing("locked"), locked: true };
    const eligible = listing("eligible");
    browserFixture([older, future, locked, eligible, eligible]);
    const summary = await runSweep(true);
    const store = promotionStore();
    const root = archiveRun("preview");
    const page = await store.read(
      `${root}/listings/000001.json`,
      RedditDatasetObservationSchema,
    );
    expect(page?.value).toMatchObject({
      schemaVersion: 1,
      kind: "listing",
      posts: ["older", "future", "locked", "eligible", "eligible"].map(
        (id) => ({
          id,
        }),
      ),
    });
    expect(summary.assessed).toBe(1);
    expect(
      await store.read(
        `${root}/threads/000001.json`,
        RedditDatasetObservationSchema,
      ),
    ).toMatchObject({
      value: {
        kind: "thread",
        post: { id: "eligible", body: "Private request body" },
      },
    });
  });

  it("keeps the page pending if all archive writes fail", async () => {
    const store = promotionStore();
    const original = store.put;
    const put = vi.spyOn(store, "put");
    let failedWrites = 0;
    put.mockImplementation((key, value, etag) => {
      if (!key.startsWith(REDDIT_DATASET_PREFIX))
        return original(key, value, etag);
      failedWrites++;
      return Promise.reject(new Error("Archive unavailable"));
    });
    const browser = browserFixture([listing("eligible")]);
    const summary = await runSweep();
    expect(summary).toMatchObject({
      stopReason: "blocked",
      failureCategory: "storage",
      coverage: [{ complete: false }],
      assessed: 0,
    });
    expect(browser.readThread).not.toHaveBeenCalled();
    expect(failedWrites).toBe(3);
    put.mockRestore();
    const retry = await new MockActivityEnvironment({
      namespace: "prod",
      workflowExecution: { workflowId, runId: "next-fixture-run" },
    }).run(sweepRedditOutreach, {});
    expect(retry.assessed).toBe(1);
  });

  it("allows validated community overrides only during a preview", async () => {
    await expect(runSweep(false, ["AnotherSubreddit"])).rejects.toThrow(
      "Reddit subreddit overrides require a preview",
    );
    await expect(
      runSweep(true, ["AnotherSubreddit", "anothersubreddit"]),
    ).rejects.toThrow("Subreddit names must be unique");
    await expect(runSweep(true, ["AnotherSubreddit"])).resolves.toMatchObject({
      preview: true,
      coverage: [{ subreddit: "AnotherSubreddit" }],
    });
    expect(executeRedditOutreachReply).not.toHaveBeenCalled();
  });
});

describe("Reddit outreach sweep audit records", () => {
  it("audits a scanner-blocked thread and continues to an eligible post", async () => {
    const blocked = listing("flagged");
    const next = listing("eligible");
    const browser = browserFixture([blocked, next]);
    browser.readThread.mockRejectedValueOnce(
      new PromotionSnapshotBlocked(blocked.url, "#siteTable"),
    );
    vi.mocked(executeRedditOutreachReply).mockResolvedValueOnce({
      postId: next.id,
      status: "verified",
      summary: "Verified reply fixture",
    });

    const summary = await runSweep();

    expect(summary).toMatchObject({
      stopReason: "exhausted",
      assessed: 1,
      metrics: { draftsPrepared: 1, reasons: { "publish-verified": 1 } },
      failureCategory: "browser",
      failures: [
        {
          subreddit,
          reason: `PinchTab content scanner blocked #siteTable at ${blocked.url}`,
        },
      ],
      coverage: [
        { found: 2, scored: 1, skipped: 1, pending: 0, complete: true },
      ],
    });
    expect(screenRedditBatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        items: [{ post: thread(next), rules: "Replies welcome" }],
      }),
    );
    expect(draftRedditInvite).toHaveBeenCalledTimes(1);
    expect(executeRedditOutreachReply).toHaveBeenCalledTimes(1);
    expect(
      await readRedditSweepPostPage(promotionStore(), summary.occurrenceId, 0),
    ).toMatchObject({
      status: "available",
      posts: [
        {
          id: blocked.id,
          score: null,
          result: "skipped",
          reason: "PinchTab content scanner blocked #siteTable",
        },
        { id: next.id, score: 0.9, result: "publish-verified" },
      ],
    });
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
    expect(
      await readRedditSweepPostPage(store, summary.occurrenceId, 0),
    ).toEqual({ status: "unavailable" });
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

it("retains scores and unprocessed posts when drafting fails", async () => {
  browserFixture([listing("first"), listing("second")]);
  vi.mocked(draftRedditInvite).mockRejectedValueOnce(
    new Error("Private draft failure"),
  );
  const summary = await runSweep();
  expect(summary.coverage).toMatchObject([
    { found: 2, scored: 0, skipped: 0, pending: 2, complete: false },
  ]);
  const page = await readRedditSweepPostPage(
    promotionStore(),
    summary.occurrenceId,
    0,
  );
  expect(page).toMatchObject({
    status: "available",
    posts: [
      { id: "first", score: 0.9, result: "pending" },
      { id: "second", score: null, result: "pending" },
    ],
  });
});
