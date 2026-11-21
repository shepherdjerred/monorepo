import { describe, expect, it } from "vitest";
import {
  assertRedditBrowserAccess,
  readRedditCommentReceipt,
  readRedditFeedPage,
  readRedditRules,
  RedditBrowserReadError,
  validateRedditFeedPageUrl,
  type RedditPageReader,
} from "./browser-reader.ts";
import {
  redditBrowserAccessScript,
  redditFeedPageScript,
  redditRulesScript,
} from "./browser-scripts.ts";

const community = "MinecraftServer";
const feedUrl = `https://old.reddit.com/r/${community}/new/`;
const access: {
  loggedInUsername: string | null;
  challenge: boolean;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  cursorExpired: boolean;
} = {
  loggedInUsername: "the_storm_mc",
  challenge: false,
  rateLimited: false,
  retryAfterSeconds: null,
  cursorExpired: false,
};
const post = {
  id: "abc123",
  subreddit: community,
  url: `https://www.reddit.com/r/${community}/comments/abc123/looking_for_an_smp/`,
  author: "reader",
  title: "Looking for a small SMP",
  createdAt: "2026-11-20T17:00:00Z",
  flair: "Joining",
  sticky: false,
  removed: false,
  locked: false,
  archived: false,
  over18: false,
};

it("scans the exact public comment body before reading modern receipt metadata", async () => {
  const url =
    "https://www.reddit.com/r/MinecraftServer/comments/abc123/request/xyz789/";
  const comment = {
    id: "xyz789",
    author: "the_storm_mc",
    body: "Our server supports Java and Bedrock.",
    parentId: "t3_abc123",
    createdAt: "2026-11-20T17:15:00Z",
  };
  const events: string[] = [];
  const reader: RedditPageReader = {
    currentUrl: async () => url,
    snapshot: async ({ selector }) => {
      events.push(selector);
      return { url, text: comment.body, publishedAt: null };
    },
    evaluate: async () => {
      events.push("read metadata");
      return comment;
    },
  };
  await expect(readRedditCommentReceipt(reader)).resolves.toMatchObject({
    url,
    redditComment: comment,
    publishedAt: comment.createdAt,
  });
  expect(events).toEqual([
    'shreddit-comment[thingid="t1_xyz789"] > [slot="comment"]',
    "read metadata",
  ]);
});

function fixture(
  options: {
    url?: string;
    page?: { posts: (typeof post)[]; next: string | null };
    access?: typeof access;
    blockedSelector?: string;
  } = {},
) {
  const events: string[] = [];
  const browser: RedditPageReader = {
    currentUrl: async () => options.url ?? feedUrl,
    snapshot: async (scope) => {
      events.push(`scan:${scope.selector}`);
      if (scope.selector === options.blockedSelector)
        throw new Error("IDPI content scan blocked");
      return {
        url: options.url ?? feedUrl,
        text: "UNTRUSTED CONTENT",
        publishedAt: null,
      };
    },
    evaluate: async (script) => {
      if (script === redditBrowserAccessScript) {
        events.push("read:access");
        return options.access ?? access;
      }
      if (script === redditFeedPageScript(100)) {
        events.push("read:feed");
        return (
          options.page ?? {
            posts: [post],
            next: `${feedUrl}?count=25&after=t3_abc123`,
          }
        );
      }
      if (script === redditRulesScript) {
        events.push("read:rules");
        return "Relevant replies from server owners are welcome. No unsolicited DMs.";
      }
      throw new Error("Unexpected script");
    },
  };
  return { browser, events };
}

describe("scoped browser Reddit feed ingestion", () => {
  it("scans account context and the feed before extracting typed post metadata and Next", async () => {
    const { browser, events } = fixture();
    const page = await readRedditFeedPage(browser, {
      subreddit: community,
      limit: 100,
      account: "THE_STORM_MC",
    });
    expect(page).toEqual({
      posts: [
        {
          ...post,
          url: `https://www.reddit.com/r/${community}/comments/abc123/`,
        },
      ],
      next: `${feedUrl}?count=25&after=t3_abc123`,
    });
    expect(events).toEqual([
      "scan:body",
      "read:access",
      "scan:#siteTable",
      "read:feed",
    ]);
  });

  it.each(["body", "#siteTable"])(
    "does not extract data from a blocked %s scan",
    async (blockedSelector) => {
      const { browser, events } = fixture({ blockedSelector });
      await expect(
        readRedditFeedPage(browser, {
          subreddit: community,
          limit: 100,
          account: "the_storm_mc",
        }),
      ).rejects.toThrow("IDPI content scan blocked");
      expect(events).not.toContain("read:feed");
      if (blockedSelector === "body")
        expect(events).not.toContain("read:access");
    },
  );

  it("rejects mismatched communities and changed page URLs", async () => {
    const foreign = fixture({
      page: { posts: [{ ...post, subreddit: "OtherServer" }], next: null },
    });
    await expect(
      readRedditFeedPage(foreign.browser, {
        subreddit: community,
        limit: 100,
        account: "the_storm_mc",
      }),
    ).rejects.toThrow(/identity|different community/);
    const changed = fixture();
    let reads = 0;
    changed.browser.currentUrl = async () =>
      reads++ === 0 ? feedUrl : `${feedUrl}?after=t3_different`;
    await expect(
      readRedditFeedPage(changed.browser, {
        subreddit: community,
        limit: 100,
        account: "the_storm_mc",
      }),
    ).rejects.toThrow("changed during");
  });

  it("returns an empty final page as observed rather than inventing an expired cursor", async () => {
    const { browser } = fixture({ page: { posts: [], next: null } });
    expect(
      await readRedditFeedPage(browser, {
        subreddit: community,
        limit: 100,
        account: "the_storm_mc",
      }),
    ).toEqual({ posts: [], next: null });
  });

  it("reads rules only from the exact observed community page after a scoped scan", async () => {
    const { browser, events } = fixture({
      url: `https://old.reddit.com/r/${community}/about/rules/`,
    });
    expect(
      await readRedditRules(browser, {
        subreddit: community,
        account: "the_storm_mc",
      }),
    ).toBe(
      "Relevant replies from server owners are welcome. No unsolicited DMs.",
    );
    expect(events).toEqual([
      "scan:body",
      "read:access",
      "scan:.subreddit-rules-page, .rules-page",
      "read:rules",
    ]);
    const wrongPage = fixture({
      url: "https://old.reddit.com/r/OtherServer/about/rules/",
    });
    await expect(
      readRedditRules(wrongPage.browser, {
        subreddit: community,
        account: "the_storm_mc",
      }),
    ).rejects.toThrow("outside the configured community");
    expect(wrongPage.events).not.toContain("read:rules");
  });
});

describe("observed Reddit account blockers", () => {
  it.each([
    { change: { loggedInUsername: null }, kind: "identity" },
    { change: { loggedInUsername: "different_user" }, kind: "identity" },
    { change: { challenge: true }, kind: "challenge" },
    { change: { rateLimited: true }, kind: "rate-limit" },
    { change: { cursorExpired: true }, kind: "cursor" },
  ])("classifies $kind before reading the feed", async ({ change, kind }) => {
    const { browser, events } = fixture({ access: { ...access, ...change } });
    await expect(
      readRedditFeedPage(browser, {
        subreddit: community,
        limit: 100,
        account: "the_storm_mc",
      }),
    ).rejects.toMatchObject({ kind });
    expect(events).not.toContain("read:feed");
  });

  it("retains the observed rate-limit deadline and prioritizes it over logged-out markup", () => {
    let failure: unknown;
    try {
      assertRedditBrowserAccess(
        {
          ...access,
          rateLimited: true,
          retryAfterSeconds: 120,
          loggedInUsername: null,
        },
        "the_storm_mc",
        Date.parse("2026-11-20T18:00:00Z"),
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(RedditBrowserReadError);
    expect(failure).toMatchObject({
      kind: "rate-limit",
      retryAt: "2026-11-20T18:02:00.000Z",
    });
  });
});

describe("same-feed Next validation", () => {
  it("accepts only an initial feed URL or observed after/count pagination", () => {
    expect(validateRedditFeedPageUrl(feedUrl, community)).toBe(feedUrl);
    expect(
      validateRedditFeedPageUrl(
        `${feedUrl}?after=t3_abc123&count=100`,
        community,
      ),
    ).toBe(`${feedUrl}?after=t3_abc123&count=100`);
  });
  it.each([
    "http://old.reddit.com/r/MinecraftServer/new/",
    "https://www.reddit.com/r/MinecraftServer/new/",
    "https://old.reddit.com/r/OtherServer/new/",
    "https://old.reddit.com/r/MinecraftServer/hot/",
    "https://old.reddit.com/r/MinecraftServer/new/?before=t3_abc",
    "https://old.reddit.com/r/MinecraftServer/new/?after=t3_abc&after=t3_def",
    "https://old.reddit.com/r/MinecraftServer/new/?after=https://evil.example",
    "https://old.reddit.com/r/MinecraftServer/new/?after=t3_abc&count=-1",
    "https://old.reddit.com/r/MinecraftServer/new/?count=25",
    "https://old.reddit.com/r/MinecraftServer/new/#publish",
    "https://user:password@old.reddit.com/r/MinecraftServer/new/",
  ])("rejects %s", (url) => {
    expect(() => validateRedditFeedPageUrl(url, community)).toThrow(
      RedditBrowserReadError,
    );
  });
});
