import { describe, expect, it, vi } from "vitest";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import { PromotionTaskJournal } from "#activities/promotion/publication/task.ts";
import type { PromotionTaskResult } from "#activities/promotion/publication/task-contract.ts";
import type { RedditRequestPost } from "#activities/promotion/reddit-discovery/model.ts";
import {
  executeRedditOutreachReply,
  assertFreshRedditRequest,
} from "./index.ts";
import {
  claimRedditReply,
  finishRedditReply,
  readRedditReplyRecord,
  readRedditReplyReservations,
  reserveRedditReplyAllowance,
  type RedditReplyRecord,
} from "./ledger.ts";
import { RedditAccountBusy, withRedditPromotionAccount } from "./ownership.ts";

const now = new Date("2026-11-15T18:00:00Z");
const post: RedditRequestPost = {
  id: "abc123",
  subreddit: "MinecraftServer",
  url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/",
  author: "seekingplayer",
  title: "looking for a small SMP",
  body: "Java survival with few plugins please",
  createdAt: "2026-11-15T17:00:00Z",
  ownReplyIds: [],
  commentsComplete: true,
  loggedInUsername: "the_storm_mc",
  removed: false,
  locked: false,
  archived: false,
};
const reply =
  "hi! we're a small survival server with optional quests :) https://join.ts-mc.net/";

function harness(uncertain = false) {
  const store = memoryPromotionStore();
  let runs = 0;
  const input = {
    post,
    replyText: reply,
    relevanceReason: "Explicitly seeks a small survival server",
    occurrenceId: "sweep/first/reply/abc123",
    store,
    settings: {
      maxRepliesPerDay: 10,
      maxPostAgeHours: 24,
      model: "gpt-5.6-luna",
      dailySpendUsd: 5,
    },
    now: () => now,
    enabled: () => Promise.resolve(true),
    inspect: () => Promise.resolve(post),
    run: async (
      assignment: Parameters<
        NonNullable<Parameters<typeof executeRedditOutreachReply>[0]["run"]>
      >[0],
    ) => {
      runs++;
      const guard = assignment.replyAssignment;
      if (guard === undefined) throw new Error("Missing reply assignment");
      const url = `${post.url}request/comment123/`;
      const page = {
        url,
        text: reply,
        publishedAt: now.toISOString(),
        screenshotKey: "comment.png",
        redditComment: {
          id: "comment123",
          author: "the_storm_mc",
          body: reply,
          createdAt: now.toISOString(),
          parentId: `t3_${post.id}`,
        },
      };
      const journal = new PromotionTaskJournal({
        ...assignment,
        now: () => now.getTime(),
        enabled: guard.enabled,
        beforeMutation: guard.beforeMutation,
        capture: () => Promise.resolve(page),
      });
      journal.observe({ url: post.url, text: "Original request; no replies" });
      await journal.beforeMutation({ key: "reply", text: reply });
      await journal.beforeMutation();
      if (uncertain) throw new Error("Submit response was lost");
      const result: PromotionTaskResult = {
        status: "verified",
        summary: "Reply is publicly visible",
        performedAction: true,
        nextEligibleAt: null,
        preparedContent: reply,
        evidence: [],
        receipt: {
          status: "verified",
          url,
          quote: reply,
          occurrenceId: assignment.occurrenceId,
        },
      };
      await journal.finish(result);
      return {
        result,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningTokens: 0,
        },
        browserTrace: [],
      };
    },
  };
  return { input, store, runs: () => runs };
}

async function seedPriorReply(
  store: ReturnType<typeof memoryPromotionStore>,
  timestamp: string,
  options: {
    subreddit?: string;
    status?: RedditReplyRecord["status"];
    release?: boolean;
  } = {},
) {
  const {
    subreddit = "minecraftserver",
    status = "verified",
    release = false,
  } = options;
  const postId = "prior";
  const occurrenceId = "earlier/reply/prior";
  const reservedAt = new Date(timestamp);
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}/`;
  const releaseAllowance = await reserveRedditReplyAllowance(
    store,
    postId,
    10,
    reservedAt,
  );
  if (releaseAllowance === null)
    throw new Error("Failed to reserve earlier reply");
  expect(
    await claimRedditReply(store, occurrenceId, reservedAt, {
      post: { ...post, id: postId, subreddit, url },
      replyText: reply.replace(" :) ", " :)\n\n"),
      relevanceReason: "Explicitly seeks a small survival server",
    }),
  ).toBe(true);
  if (status !== "claimed")
    await finishRedditReply(store, {
      postId,
      occurrenceId,
      status,
      completedAt: reservedAt.toISOString(),
      receiptUrl: status === "verified" ? `${url}comment/earlier/` : null,
      summary: "Earlier reply attempt",
    });
  if (release) await releaseAllowance();
}

describe("Reddit reply repetition", () => {
  it.each(["verified", "claimed", "uncertain", "blocked"] as const)(
    "rejects repeating a reserved %s reply from the prior Pacific date before opening Reddit",
    async (status) => {
      const test = harness();
      await seedPriorReply(test.store, "2026-11-15T07:45:00Z", { status });
      const validate = vi.fn(() => Promise.resolve(true));
      const inspect = vi.fn(test.input.inspect);
      const result = await executeRedditOutreachReply({
        ...test.input,
        validate,
        inspect,
      });
      expect(result).toMatchObject({
        status: "duplicate",
        summary: expect.stringContaining(
          "same outreach reply in the last 24 hours",
        ),
      });
      expect(validate).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      expect(test.runs()).toBe(0);
      expect(await readRedditReplyRecord(test.store, post.id)).toBeUndefined();
      expect(
        await readRedditReplyReservations(test.store, "2026-11-15"),
      ).toEqual([]);
    },
  );

  it("checks the third Pacific date when the last 24 hours span spring-forward", async () => {
    const test = harness();
    await seedPriorReply(test.store, "2026-03-08T07:50:00Z");
    const springPost = { ...post, createdAt: "2026-03-09T07:00:00Z" };
    expect(
      await executeRedditOutreachReply({
        ...test.input,
        post: springPost,
        inspect: () => Promise.resolve(springPost),
        now: () => new Date("2026-03-09T07:15:00Z"),
      }),
    ).toMatchObject({ status: "duplicate" });
    expect(test.runs()).toBe(0);
  });

  it("keeps a reservation for the new Pacific date when midnight follows the initial reservation", async () => {
    const test = harness();
    const put = test.store.put;
    let clock = new Date("2026-11-16T07:59:59Z");
    test.store.put = async (key, ...args) => {
      const written = await put(key, ...args);
      if (key === "reddit-outreach/daily/2026-11-15.json")
        clock = new Date("2026-11-16T08:00:00Z");
      return written;
    };
    expect(
      await executeRedditOutreachReply({ ...test.input, now: () => clock }),
    ).toMatchObject({ status: "verified" });
    expect(await readRedditReplyReservations(test.store, "2026-11-16")).toEqual(
      [post.id],
    );
  });

  it("allows the same text in another subreddit", async () => {
    const test = harness();
    await seedPriorReply(test.store, "2026-11-15T07:45:00Z", {
      subreddit: "MinecraftSMPs",
    });
    expect(await executeRedditOutreachReply(test.input)).toMatchObject({
      status: "verified",
    });
  });

  it("allows old or proven unsent text to be used again in the same subreddit", async () => {
    const older = harness();
    await seedPriorReply(older.store, "2026-11-14T17:59:00Z");
    expect(await executeRedditOutreachReply(older.input)).toMatchObject({
      status: "verified",
    });

    const unsent = harness();
    await seedPriorReply(unsent.store, "2026-11-15T07:45:00Z", {
      status: "blocked",
      release: true,
    });
    expect(await executeRedditOutreachReply(unsent.input)).toMatchObject({
      status: "verified",
    });
  });
});

describe("Reddit reply execution", () => {
  it("publishes once, verifies a comment receipt, and suppresses subsequent sweeps", async () => {
    const test = harness();
    expect(await executeRedditOutreachReply(test.input)).toMatchObject({
      status: "verified",
      postId: post.id,
    });
    expect(
      await executeRedditOutreachReply({
        ...test.input,
        occurrenceId: "next-sweep",
      }),
    ).toMatchObject({ status: "duplicate" });
    expect(test.runs()).toBe(1);
    expect(await readRedditReplyRecord(test.store, post.id)).toMatchObject({
      status: "verified",
      post,
      replyText: reply,
    });
  });

  it("retains uncertainty after a dispatched action and never retries it", async () => {
    const test = harness(true);
    expect(await executeRedditOutreachReply(test.input)).toMatchObject({
      status: "blocked",
    });
    expect(await readRedditReplyRecord(test.store, post.id)).toMatchObject({
      status: "uncertain",
    });
    expect(
      await executeRedditOutreachReply({
        ...test.input,
        occurrenceId: "retry",
      }),
    ).toMatchObject({ status: "duplicate" });
    expect(test.runs()).toBe(1);
  });

  it("rechecks the request immediately before a mutation", async () => {
    const test = harness();
    let reads = 0;
    const result = await executeRedditOutreachReply({
      ...test.input,
      inspect: () => {
        reads++;
        return Promise.resolve(
          reads === 1 ? post : { ...post, ownReplyIds: ["manualcomment"] },
        );
      },
    });
    expect(result.status).toBe("blocked");
    expect(reads).toBe(2);
    expect(await readRedditReplyRecord(test.store, post.id)).toMatchObject({
      status: "blocked",
    });
    const allowance = await reserveRedditReplyAllowance(
      test.store,
      "another",
      1,
      now,
    );
    expect(allowance).not.toBeNull();
  });

  it.each([
    { loggedInUsername: "wrong_account" },
    { commentsComplete: false },
    { ownReplyIds: ["oldreply"] },
    { locked: true },
    { removed: true },
    { author: "the_storm_mc" },
    { body: "Now looking for a modpack" },
  ])("rejects unsafe or changed thread state before sending: %j", (change) => {
    expect(() =>
      assertFreshRedditRequest(post, { ...post, ...change }),
    ).toThrow();
  });

  it("enforces the daily cap across concurrent reservations and resets by Pacific day", async () => {
    const store = memoryPromotionStore();
    for (let index = 0; index < 9; index++)
      expect(
        await reserveRedditReplyAllowance(
          store,
          `post${String(index)}`,
          10,
          now,
        ),
      ).not.toBeNull();
    const reservations = await Promise.all(
      ["last", "overflow"].map((id) =>
        reserveRedditReplyAllowance(store, id, 10, now),
      ),
    );
    expect(
      reservations.filter((reservation) => reservation !== null),
    ).toHaveLength(1);
    expect(
      await reserveRedditReplyAllowance(
        store,
        "later",
        10,
        new Date("2026-11-16T07:59:00Z"),
      ),
    ).toBeNull();
    expect(
      await reserveRedditReplyAllowance(
        store,
        "nextday",
        10,
        new Date("2026-11-16T08:00:00Z"),
      ),
    ).not.toBeNull();
  });

  it("shares account ownership across regular promotion and outreach tasks", async () => {
    const store = memoryPromotionStore();
    const entered = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    const first = withRedditPromotionAccount(
      store,
      "regular-promotion",
      async () => {
        entered.resolve(undefined);
        await finish.promise;
      },
    );
    await entered.promise;
    await expect(
      withRedditPromotionAccount(store, "outreach", () => Promise.resolve()),
    ).rejects.toBeInstanceOf(RedditAccountBusy);
    finish.resolve(undefined);
    await first;
    await expect(
      withRedditPromotionAccount(store, "outreach", () =>
        Promise.resolve("claimed"),
      ),
    ).resolves.toBe("claimed");
  });
});
