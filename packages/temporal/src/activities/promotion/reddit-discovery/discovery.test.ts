import { describe, expect, it, vi } from "vitest";
import { discoverRedditRequests, eligibleRedditRequest } from "./index.ts";
import { canonicalRedditPostUrl, type RedditRequestPost } from "./model.ts";

const NOW = Date.parse("2026-11-15T18:00:00Z");
const post: RedditRequestPost = {
  id: "abc123",
  subreddit: "MinecraftServer",
  url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/",
  author: "looking_for_friends",
  title: "Looking for a small Java SMP",
  body: "I want a relaxed survival server to join.",
  createdAt: "2026-11-15T17:00:00Z",
  ownReplyIds: [],
  commentsComplete: true,
  removed: false,
  locked: false,
  archived: false,
  loggedInUsername: "the_storm_mc",
};
const eligibility = {
  now: NOW,
  maxPostAgeHours: 24,
  account: "the_storm_mc",
  alreadyHandled: new Set<string>(),
};
const settings = {
  subreddits: ["MinecraftServer"],
  maxPostAgeHours: 24,
  maxPostsPerSubreddit: 25,
  maxRepliesPerSweep: 1,
  maxRepliesPerDay: 10,
};

describe("Reddit request discovery", () => {
  it("requires fresh, open threads without a prior reply or unresolved attempt", () => {
    expect(eligibleRedditRequest(post, eligibility)).toBe(true);
    for (const change of [
      { createdAt: "2026-11-14T17:59:59Z" },
      { createdAt: "2026-11-15T18:00:01Z" },
      { ownReplyIds: ["oldreply"] },
      { commentsComplete: false },
      { removed: true },
      { locked: true },
      { archived: true },
      { author: "THE_STORM_MC" },
      { author: "[deleted]" },
    ])
      expect(eligibleRedditRequest({ ...post, ...change }, eligibility)).toBe(
        false,
      );
    expect(
      eligibleRedditRequest(post, {
        ...eligibility,
        alreadyHandled: new Set([post.id]),
      }),
    ).toBe(false);
  });

  it("canonicalizes same-post URLs and rejects foreign origins and mismatched identities", () => {
    expect(
      canonicalRedditPostUrl(
        "https://old.reddit.com/r/MinecraftServer/comments/abc123/a_title/?sort=new",
      ),
    ).toBe(post.url);
    expect(() =>
      canonicalRedditPostUrl(
        "https://evil.example/r/MinecraftServer/comments/abc123/",
      ),
    ).toThrow("Expected a canonical Reddit post URL");
    expect(() =>
      eligibleRedditRequest({ ...post, id: "other" }, eligibility),
    ).toThrow("identity");
  });

  it("inspects each fresh candidate once and checks current thread state", async () => {
    const open = vi.fn((url: string) => Promise.resolve({ url }));
    const readRedditThread = vi.fn(async () => post);
    const outcome = await discoverRedditRequests({
      ...eligibility,
      subreddit: "MinecraftServer",
      settings,
      browser: {
        open,
        readRedditListing: async () => [
          post,
          post,
          {
            ...post,
            id: "stale",
            url: "https://www.reddit.com/r/MinecraftServer/comments/stale/",
            createdAt: "2026-11-13T17:00:00Z",
          },
        ],
        readRedditThread,
      },
    });
    expect(outcome).toEqual({ posts: [post], inspected: 1 });
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      "https://old.reddit.com/r/MinecraftServer/new/",
      "https://old.reddit.com/r/MinecraftServer/comments/abc123/",
    ]);
    expect(readRedditThread).toHaveBeenCalledTimes(1);
  });

  it("does not turn an unavailable feed into a successful empty discovery", async () => {
    await expect(
      discoverRedditRequests({
        ...eligibility,
        subreddit: "MinecraftServer",
        settings,
        browser: {
          open: async () => ({ url: post.url }),
          readRedditListing: () => Promise.reject(new Error("Reddit HTTP 429")),
          readRedditThread: async () => post,
        },
      }),
    ).rejects.toThrow("Reddit HTTP 429");
  });
});
