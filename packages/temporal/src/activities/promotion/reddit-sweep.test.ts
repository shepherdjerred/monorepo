import { describe, expect, it, vi } from "vitest";
import { memoryPromotionStore } from "./test-support.ts";
import {
  redditAssessmentFingerprint,
  screenRedditBatch,
} from "./reddit-discovery/screening.ts";
import {
  qualifiesForRedditDraft,
  type RedditJudgePost,
  type RedditQualification,
} from "./reddit-discovery/decisions.ts";

const post: RedditJudgePost = {
  id: "abc123",
  subreddit: "MinecraftServer",
  url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/",
  author: "seeking-player",
  title: "Looking for a small SMP",
  body: "Java and Bedrock friends want towns.",
  createdAt: "2026-11-19T12:00:00Z",
};
const qualification: RedditQualification = {
  decision: "match",
  judgeScore: 0.9,
  reason: "Crossplay and towns meet the main request.",
  explicitlySeekingServer: true,
  communityAllowsReply: true,
  hardConstraintsSatisfied: true,
};
const usage = {
  tokens: {
    input: 1,
    output: 0,
    cachedInput: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 1,
  },
  catalogCostUsd: 0,
};
function fixture() {
  const judge = vi.fn(async () => ({ qualification, usage }));
  return {
    store: memoryPromotionStore(),
    judge,
    dailySpendUsd: 5,
    signal: new AbortController().signal,
  };
}

describe("Reddit Decisions assessment caching", () => {
  it("reuses both matched and rejected qualifications without another judge call", async () => {
    const input = fixture();
    input.judge.mockResolvedValueOnce({
      qualification: {
        ...qualification,
        decision: "no-match",
        judgeScore: 0.2,
      },
      usage,
    });
    const items = [{ post, rules: "Server recommendations are welcome." }];
    const first = await screenRedditBatch({
      ...input,
      items,
      reservationId: "first",
    });
    const second = await screenRedditBatch({
      ...input,
      items,
      reservationId: "second",
    });
    expect(first).toMatchObject({ assessed: 1, cached: 0 });
    expect(second).toMatchObject({ assessed: 0, cached: 1 });
    expect(second.matches).toEqual(first.matches);
    expect(second.matches[0]?.qualification.decision).toBe("no-match");
    expect(input.judge).toHaveBeenCalledTimes(1);
  });

  it("reports the original decision answers when the same post is cached", async () => {
    const input = fixture();
    const answers = [
      {
        name: "strong_main_match",
        type: "predicate" as const,
        probability: 0.9,
      },
    ];
    const judge = vi.fn(async () => ({ qualification, usage, answers }));
    const onAssessment = vi.fn(() => Promise.resolve());
    const request = {
      ...input,
      items: [{ post, rules: "Server recommendations are welcome." }],
      judge,
      onAssessment,
    };

    await screenRedditBatch({ ...request, reservationId: "first" });
    await screenRedditBatch({ ...request, reservationId: "second" });

    expect(judge).toHaveBeenCalledTimes(1);
    expect(onAssessment).toHaveBeenCalledTimes(2);
    expect(onAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        post,
        answers,
        capturedAt: expect.any(String),
      }),
    );
    expect(onAssessment.mock.calls[0]).toEqual(onAssessment.mock.calls[1]);
  });

  it("judges only new items in a mixed cached and uncached batch", async () => {
    const input = fixture();
    const item = { post, rules: "Recommendations are welcome." };
    await screenRedditBatch({
      ...input,
      items: [item],
      reservationId: "first",
    });
    const fresh = {
      ...post,
      id: "def456",
      url: "https://www.reddit.com/r/MinecraftServer/comments/def456/",
    };
    const result = await screenRedditBatch({
      ...input,
      items: [item, { ...item, post: fresh }],
      reservationId: "second",
    });
    expect(result).toMatchObject({ assessed: 1, cached: 1 });
    expect(result.matches.map((match) => match.post.id)).toEqual([
      post.id,
      fresh.id,
    ]);
    expect(input.judge).toHaveBeenCalledTimes(2);
  });

  it.each([
    { title: "Looking for a specific modpack" },
    { body: "Actually, we require a modpack." },
  ])("reassesses an edited request: %j", async (change) => {
    const input = fixture();
    const item = { post, rules: "Recommendations are welcome." };
    await screenRedditBatch({
      ...input,
      items: [item],
      reservationId: "first",
    });
    const result = await screenRedditBatch({
      ...input,
      items: [{ ...item, post: { ...post, ...change } }],
      reservationId: "second",
    });
    expect(result).toMatchObject({ assessed: 1, cached: 0 });
    expect(input.judge).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached qualification when community rules change", async () => {
    const input = fixture();
    await screenRedditBatch({
      ...input,
      items: [{ post, rules: "Recommendations welcome." }],
      reservationId: "first",
    });
    const result = await screenRedditBatch({
      ...input,
      items: [{ post, rules: "Automated comments are forbidden." }],
      reservationId: "second",
    });
    expect(result).toMatchObject({ assessed: 1, cached: 0 });
    expect(input.judge).toHaveBeenCalledTimes(2);
  });

  it("keeps final thread rechecks separate from listing cache entries", async () => {
    const input = fixture();
    const item = { post, rules: "Recommendations welcome." };
    await screenRedditBatch({
      ...input,
      items: [item],
      reservationId: "listing",
    });
    const thread = await screenRedditBatch({
      ...input,
      items: [item],
      cacheScope: "thread",
      reservationId: "thread",
    });
    const repeated = await screenRedditBatch({
      ...input,
      items: [item],
      cacheScope: "thread",
      reservationId: "thread-again",
    });
    const listing = await screenRedditBatch({
      ...input,
      items: [item],
      reservationId: "listing-again",
    });
    expect(thread).toMatchObject({ assessed: 1, cached: 0 });
    expect(repeated).toMatchObject({ assessed: 0, cached: 1 });
    expect(listing).toMatchObject({ assessed: 0, cached: 1 });
    expect(input.judge).toHaveBeenCalledTimes(2);
  });

  it("ignores observation metadata and community case in semantic fingerprints", () => {
    const rules = "Recommendations welcome.";
    expect(redditAssessmentFingerprint({ post, rules })).toBe(
      redditAssessmentFingerprint({
        post: {
          ...post,
          subreddit: "minecraftserver",
          createdAt: "2026-11-19T12:01:00Z",
        },
        rules,
      }),
    );
  });
});

describe("Reddit Decisions qualification threshold", () => {
  it.each([0, 0.59, 0.599999])(
    "declines a match probability of %s",
    (judgeScore) => {
      expect(qualifiesForRedditDraft({ ...qualification, judgeScore })).toBe(
        false,
      );
    },
  );
  it("accepts .60 or higher with all other gates satisfied", () => {
    expect(qualifiesForRedditDraft({ ...qualification, judgeScore: 0.6 })).toBe(
      true,
    );
    for (const change of [
      { decision: "no-match" as const },
      { explicitlySeekingServer: false },
      { communityAllowsReply: false },
      { hardConstraintsSatisfied: false },
    ])
      expect(qualifiesForRedditDraft({ ...qualification, ...change })).toBe(
        false,
      );
  });
});
