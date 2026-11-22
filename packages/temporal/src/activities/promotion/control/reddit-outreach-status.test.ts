import { beforeEach, expect, it, vi } from "vitest";
import { RedditOutreachOverviewSchema } from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import {
  claimRedditReply,
  finishRedditReply,
  reserveRedditReplyAllowance,
} from "#activities/promotion/reddit-outreach/ledger.ts";
import { recordRedditAccountFailure } from "#activities/promotion/reddit-outreach/ownership.ts";
import {
  recordSweep,
  type SweepSummary,
} from "#activities/promotion/reddit-outreach/sweep-audit.ts";
import { readRedditOutreachOverview } from "./reddit-outreach-status.ts";
import type {
  NativeRedditOutreachSchedule,
  readRedditOutreachSchedule,
} from "./status-reddit-schedule.ts";

const settings = vi.hoisted(() => ({
  promotion: vi.fn(),
  outreach: vi.fn(),
}));
vi.mock("#config/promotion.ts", () => ({
  promotionConfig: settings.promotion,
}));
vi.mock("#config/reddit-outreach.ts", () => ({
  redditOutreachConfig: settings.outreach,
}));

const now = Date.parse("2026-11-02T07:50:00Z");
const completedAt = "2026-11-01T07:19:00.000Z";
const schedule: NativeRedditOutreachSchedule = {
  schedule: {
    state: "active",
    lastRunAt: "2026-11-01T07:15:00.000Z",
    nextRunAt: "2026-11-02T08:00:00.000Z",
  },
  executions: [],
};
const readSchedule = vi.fn<typeof readRedditOutreachSchedule>(() =>
  Promise.resolve(schedule),
);

function sweep(
  occurrenceId: string,
  changes: Partial<SweepSummary> = {},
): SweepSummary {
  return {
    occurrenceId,
    completedAt,
    preview: false,
    inspected: 18,
    assessed: 3,
    cached: 2,
    elapsedMs: 35_000,
    stopReason: "exhausted",
    metrics: {
      draftsPrepared: 1,
      reasons: { "score-too-low": 2, "permission-unconfirmed": 1 },
    },
    failures: [],
    replies: [],
    drafts: [],
    ...changes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.promotion.mockResolvedValue({ available: true, enabled: false });
  settings.outreach.mockResolvedValue({
    enabled: true,
    available: true,
    maxRepliesPerDay: 10,
    maxRepliesPerSweep: 10,
  });
});

it("reports a quiet production day and independently reflects disabled publishing and account cooldown", async () => {
  const store = memoryPromotionStore();
  const quiet = await readRedditOutreachOverview(store, now, readSchedule);
  expect(quiet).toEqual({
    status: "available",
    schedule: schedule.schedule,
    publishing: "enabled",
    account: { hold: null, retryAt: null },
    today: {
      day: "2026-11-01",
      inspected: 0,
      assessed: 0,
      cached: 0,
      draftsPrepared: 0,
      verifiedReplies: 0,
      unresolvedReplies: 0,
      remainingSlots: 10,
    },
    runs: [],
  });
  settings.outreach.mockResolvedValueOnce({
    enabled: true,
    available: true,
    maxRepliesPerDay: 5,
    maxRepliesPerSweep: 0,
  });
  const retryAt = "2026-11-02T09:00:00.000Z";
  await recordRedditAccountFailure(store, { kind: "rate-limit", retryAt }, now);
  const disabled = await readRedditOutreachOverview(store, now, readSchedule);
  expect(disabled).toMatchObject({
    publishing: "disabled",
    account: { retryAt },
  });
  await recordRedditAccountFailure(store, { kind: "logged-out" }, now);
  const held = await readRedditOutreachOverview(
    store,
    Date.parse(retryAt),
    readSchedule,
  );
  expect(held).toMatchObject({
    account: { hold: "logged-out", retryAt: null },
  });
});

async function claimFixture(
  store: PromotionStore,
  postId: string,
  occurrence: string,
  startedAt: Date,
) {
  const occurrenceId = `${occurrence}/reply/${postId}`;
  expect(
    await reserveRedditReplyAllowance(store, postId, 10, startedAt),
  ).not.toBeNull();
  await claimRedditReply(store, occurrenceId, startedAt, {
    post: {
      id: postId,
      subreddit: "MinecraftServer",
      url: `https://www.reddit.com/r/MinecraftServer/comments/${postId}/`,
      title: "Internal request title",
      body: "Internal request body",
      author: "fixture-author",
      createdAt: "2026-11-01T07:00:00.000Z",
      ownReplyIds: [],
      commentsComplete: true,
      removed: false,
      locked: false,
      archived: false,
      loggedInUsername: "fixture-account",
    },
    replyText: "Internal invite text",
    relevanceReason: "Internal model notes",
  });
  return occurrenceId;
}

it("projects the original reply, redacts sensitive content and deduplicates reconciliation across Pacific days", async () => {
  const store = memoryPromotionStore();
  const postId = "abc123";
  const occurrence = "the-storm-reddit-outreach-first/run";
  const startedAt = new Date("2026-11-01T07:15:00Z");
  const occurrenceId = await claimFixture(store, postId, occurrence, startedAt);
  const finish = (
    status: "uncertain" | "verified",
    receiptUrl: string | null,
    finishedAt: string,
  ) =>
    finishRedditReply(store, {
      postId,
      occurrenceId,
      status,
      receiptUrl,
      completedAt: finishedAt,
      summary: "Internal adapter details",
    });
  await finish("uncertain", null, completedAt);
  await recordSweep(
    store,
    sweep(occurrence, {
      failures: [
        { subreddit: "fixture-community", reason: "Internal adapter details" },
      ],
      failureCategory: "browser",
      replies: [
        { postId, status: "blocked", summary: "Internal adapter details" },
      ],
    }),
  );
  await recordSweep(
    store,
    sweep("preview/run", {
      preview: true,
      inspected: 900,
      drafts: [{ postId, reply: "Internal preview text" }],
    }),
  );
  await recordSweep(
    store,
    sweep("another/run", {
      completedAt: "2026-11-01T07:35:00.000Z",
      replies: [
        { postId, status: "duplicate", summary: "Internal duplicate details" },
      ],
    }),
  );
  await recordSweep(
    store,
    sweep("older/run", { completedAt: "2026-11-01T06:55:00.000Z" }),
  );
  const uncertain = RedditOutreachOverviewSchema.parse(
    await readRedditOutreachOverview(store, now, readSchedule),
  );
  expect(readSchedule).toHaveBeenCalledWith(
    "2026-10-31",
    new Set([occurrence, "another/run", "older/run"]),
    new Set(),
  );
  expect(uncertain).toMatchObject({
    today: {
      inspected: 36,
      assessed: 6,
      cached: 4,
      draftsPrepared: 2,
      verifiedReplies: 0,
      unresolvedReplies: 1,
      remainingSlots: 9,
    },
    runs: [
      { id: "another/run", unresolvedReplies: 0 },
      {
        id: occurrence,
        verifiedReceipts: [],
        unresolvedReplies: 1,
        failureCategory: "browser",
      },
      { id: "older/run" },
    ],
  });
  expect(JSON.stringify(uncertain)).not.toContain("Internal");
  expect(JSON.stringify(uncertain)).not.toContain("fixture-");

  const fullUrl = `https://old.reddit.com/r/MinecraftServer/comments/${postId}/private-slug/xyz987/?context=1#fragment`;
  const newDay = "2026-11-02T08:02:00.000Z";
  await finish("verified", fullUrl, newDay);
  const reconciled = await readRedditOutreachOverview(
    store,
    Date.parse(newDay),
    readSchedule,
  );
  expect(reconciled).toMatchObject({
    today: {
      day: "2026-11-02",
      verifiedReplies: 0,
      unresolvedReplies: 0,
      remainingSlots: 10,
    },
    runs: [
      { id: "another/run", verifiedReceipts: [], unresolvedReplies: 0 },
      {
        id: occurrence,
        verifiedReceipts: [
          `https://www.reddit.com/r/MinecraftServer/comments/${postId}/comment/xyz987/`,
        ],
        unresolvedReplies: 0,
      },
    ],
  });
});

it("counts verified and unresolved replies for an unaudited sweep outside the 12 displayed rows", async () => {
  const store = memoryPromotionStore();
  const missingSweep = "older/outside-recent-window/run";
  const start = new Date("2026-11-01T07:15:00Z");
  const postId = "verified1";
  const occurrenceId = await claimFixture(store, postId, missingSweep, start);
  await finishRedditReply(store, {
    postId,
    occurrenceId,
    status: "verified",
    receiptUrl: `https://www.reddit.com/r/MinecraftServer/comments/${postId}/title/xyz987/`,
    completedAt,
    summary: "Verified fixture reply",
  });
  await claimFixture(store, "uncertain1", missingSweep, start);

  for (let index = 1; index <= 12; index++) {
    await recordSweep(
      store,
      sweep(`newer-${String(index)}/run`, {
        completedAt: new Date(
          Date.parse(completedAt) + index * 900_000,
        ).toISOString(),
      }),
    );
  }
  readSchedule.mockImplementationOnce(
    async (_oldestDay, _audited, unauditedReplyRuns) => {
      await Promise.resolve();
      return {
        ...schedule,
        executions: unauditedReplyRuns.has(missingSweep)
          ? [
              {
                id: missingSweep,
                at: completedAt,
                completedAt,
                elapsedMs: 240_000,
                status: "failed",
              },
            ]
          : [],
      };
    },
  );
  const data = RedditOutreachOverviewSchema.parse(
    await readRedditOutreachOverview(store, now, readSchedule),
  );
  expect(data.status).toBe("available");
  if (data.status !== "available")
    throw new Error("Expected outreach fixture to load");
  expect(data.runs).toHaveLength(12);
  expect(data.runs.map(({ id }) => id)).not.toContain(missingSweep);
  expect(data.today).toMatchObject({
    verifiedReplies: 1,
    unresolvedReplies: 1,
    remainingSlots: 8,
  });
});

it("uses safe legacy verified receipts once and leaves legacy and missing breakdowns unavailable", async () => {
  const store = memoryPromotionStore();
  const postId = "abc123";
  const receiptUrl = `https://www.reddit.com/r/MinecraftServer/comments/${postId}/name/xyz987/`;
  const legacy = {
    metrics: undefined,
    stopReason: "Unmapped internal string",
    replies: [
      { postId, status: "verified", summary: "Internal details", receiptUrl },
    ],
  };
  await recordSweep(store, sweep("legacy/run", legacy));
  const coverage = [
    {
      subreddit: "MinecraftServer",
      since: "2026-11-01T07:15:00.000Z",
      until: "2026-11-01T07:30:00.000Z",
      found: 5,
      scored: 3,
      skipped: 1,
      pending: 1,
      complete: false,
    },
  ];
  await recordSweep(
    store,
    sweep("later/run", {
      ...legacy,
      completedAt: "2026-11-01T07:35:00.000Z",
      coverage,
    }),
  );
  const failedAt = "2026-11-01T07:48:00.000Z";
  readSchedule.mockResolvedValueOnce({
    ...schedule,
    executions: [
      {
        id: "failed/run",
        at: failedAt,
        completedAt: failedAt,
        elapsedMs: 1500,
        status: "failed",
      },
    ],
  });
  const data = RedditOutreachOverviewSchema.parse(
    await readRedditOutreachOverview(store, now, readSchedule),
  );
  expect(data).toMatchObject({
    today: { draftsPrepared: null, verifiedReplies: 1, unresolvedReplies: 0 },
    runs: [
      {
        id: "failed/run",
        status: "failed",
        failureCategory: "workflow",
        metrics: null,
        inspected: null,
      },
      {
        id: "later/run",
        status: "recorded",
        coverage,
        metrics: null,
        verifiedReceipts: [],
      },
      {
        id: "legacy/run",
        status: "recorded",
        stopReason: "other",
        metrics: null,
        inspected: 18,
        verifiedReceipts: [
          `https://www.reddit.com/r/MinecraftServer/comments/${postId}/comment/xyz987/`,
        ],
      },
    ],
  });
  if (data.status !== "available") throw new Error("Expected coverage data");
  expect(data.runs.find((run) => run.id === "legacy/run")).not.toHaveProperty(
    "coverage",
  );
});
