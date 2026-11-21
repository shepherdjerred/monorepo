import { z } from "zod/v4";
import {
  RedditListingPostSchema,
  RedditRequestPostSchema,
  assertRedditPostIdentity,
  canonicalRedditPostUrl,
} from "./model.ts";
import {
  redditListingScript,
  redditThreadScript,
  redditCommentReceiptScript,
  redditBrowserAccessScript,
  redditFeedPageScript,
  redditRulesScript,
} from "./browser-scripts.ts";

export class RedditBrowserReadError extends Error {
  constructor(
    readonly kind: "identity" | "challenge" | "rate-limit" | "page" | "cursor",
    message: string,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = "RedditBrowserReadError";
  }
}

const BrowserAccessSchema = z.object({
  loggedInUsername: z.string().nullable(),
  challenge: z.boolean(),
  rateLimited: z.boolean(),
  retryAfterSeconds: z
    .number()
    .nonnegative()
    .max(7 * 24 * 3600)
    .nullable(),
  cursorExpired: z.boolean().optional(),
});

export function assertRedditBrowserAccess(
  raw: unknown,
  account: string,
  now = Date.now(),
) {
  const access = BrowserAccessSchema.parse(raw);
  if (access.rateLimited)
    throw new RedditBrowserReadError(
      "rate-limit",
      "Reddit is rate limiting this account",
      access.retryAfterSeconds === null
        ? null
        : new Date(now + access.retryAfterSeconds * 1000).toISOString(),
    );
  if (access.challenge)
    throw new RedditBrowserReadError(
      "challenge",
      "Reddit requires a browser security challenge",
    );
  if (access.loggedInUsername?.toLowerCase() !== account.toLowerCase())
    throw new RedditBrowserReadError(
      "identity",
      "Reddit browser is not signed in as the configured outreach account",
    );
  if (access.cursorExpired === true)
    throw new RedditBrowserReadError(
      "cursor",
      "Reddit rejected the listing cursor",
    );
}

export const RedditFeedPostSchema = RedditListingPostSchema.extend({
  flair: z.string().nullable(),
  sticky: z.boolean(),
  removed: z.boolean(),
  locked: z.boolean(),
  archived: z.boolean(),
  over18: z.boolean(),
});
export type RedditFeedPost = z.infer<typeof RedditFeedPostSchema>;

export function validateRedditFeedPageUrl(
  address: string,
  subreddit: string,
): string {
  z.string()
    .regex(/^\w{3,21}$/)
    .parse(subreddit);
  const url = new URL(address);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "old.reddit.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.pathname.toLowerCase() !== `/r/${subreddit}/new/`.toLowerCase()
  )
    throw new RedditBrowserReadError(
      "page",
      "Reddit Next URL is outside the configured new feed",
    );
  const keys = [...url.searchParams.keys()];
  const after = url.searchParams.get("after");
  const count = url.searchParams.get("count");
  if (
    keys.some((key) => key !== "after" && key !== "count") ||
    new Set(keys).size !== keys.length ||
    (after !== null && !/^t3_[a-z0-9]+$/.test(after)) ||
    (count !== null &&
      (after === null || !/^\d+$/.test(count) || Number(count) > 1_000_000))
  )
    throw new RedditBrowserReadError(
      "page",
      "Reddit Next URL has invalid pagination parameters",
    );
  return url.href;
}
export const validateRedditListingUrl = validateRedditFeedPageUrl;

export type RedditPageReader = {
  currentUrl: () => Promise<string>;
  snapshot: (scope: { selector: string; depth?: number }) => Promise<{
    url: string;
    text: string;
    publishedAt: string | null;
  }>;
  evaluate: (expression: string) => Promise<unknown>;
};

async function inspectAccount(browser: RedditPageReader, account: string) {
  z.string()
    .regex(/^[\w-]+$/)
    .parse(account);
  await browser.snapshot({ selector: "body", depth: 3 });
  assertRedditBrowserAccess(
    await browser.evaluate(redditBrowserAccessScript),
    account,
  );
}

export async function readRedditFeedPage(
  browser: RedditPageReader,
  input: {
    subreddit: string;
    limit: number;
    account: string;
  },
): Promise<{ posts: RedditFeedPost[]; next: string | null }> {
  z.number().int().min(1).max(100).parse(input.limit);
  await inspectAccount(browser, input.account);
  const observedUrl = validateRedditFeedPageUrl(
    await browser.currentUrl(),
    input.subreddit,
  );
  await browser.snapshot({ selector: "#siteTable" });
  const page = z
    .strictObject({
      posts: z.array(RedditFeedPostSchema).max(100),
      next: z.string().nullable(),
    })
    .parse(await browser.evaluate(redditFeedPageScript(input.limit)));
  if (
    validateRedditFeedPageUrl(await browser.currentUrl(), input.subreddit) !==
    observedUrl
  )
    throw new RedditBrowserReadError(
      "page",
      "Reddit feed changed during its scanned read",
    );
  const posts = page.posts.map((post) => {
    assertRedditPostIdentity(post);
    if (post.subreddit.toLowerCase() !== input.subreddit.toLowerCase())
      throw new RedditBrowserReadError(
        "page",
        "Reddit feed contains a different community",
      );
    return { ...post, url: canonicalRedditPostUrl(post.url) };
  });
  return {
    posts,
    next:
      page.next === null
        ? null
        : validateRedditFeedPageUrl(page.next, input.subreddit),
  };
}

export async function readRedditRules(
  browser: RedditPageReader,
  input: {
    subreddit: string;
    account: string;
  },
): Promise<string> {
  await inspectAccount(browser, input.account);
  const url = new URL(await browser.currentUrl());
  z.string()
    .regex(/^\w{3,21}$/)
    .parse(input.subreddit);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "old.reddit.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    ![
      `/r/${input.subreddit}/about/rules`,
      `/r/${input.subreddit}/about/rules/`,
    ].some((path) => path.toLowerCase() === url.pathname.toLowerCase())
  )
    throw new RedditBrowserReadError(
      "page",
      "Reddit rules page is outside the configured community",
    );
  await browser.snapshot({ selector: ".subreddit-rules-page, .rules-page" });
  const text = z
    .string()
    .trim()
    .min(1)
    .max(40_000)
    .parse(await browser.evaluate(redditRulesScript));
  if ((await browser.currentUrl()) !== url.href)
    throw new RedditBrowserReadError(
      "page",
      "Reddit rules page changed during its scanned read",
    );
  return text;
}

/** Metadata extraction never runs when the corresponding IDPI scan fails. */
export async function readRedditListing(
  browser: RedditPageReader,
  input: { subreddit: string; limit: number },
) {
  z.string().regex(/^\w+$/).parse(input.subreddit);
  z.number().int().min(1).max(100).parse(input.limit);
  const url = new URL(await browser.currentUrl());
  if (
    url.hostname !== "old.reddit.com" ||
    url.pathname.toLowerCase() !== `/r/${input.subreddit}/new/`.toLowerCase()
  )
    throw new Error("Reddit discovery requires the exact old Reddit new feed");
  await browser.snapshot({ selector: "#siteTable" });
  const posts = z
    .array(RedditListingPostSchema)
    .parse(await browser.evaluate(redditListingScript(input.limit)));
  return posts.map((post) => {
    assertRedditPostIdentity(post);
    if (post.subreddit.toLowerCase() !== input.subreddit.toLowerCase())
      throw new Error("Reddit feed contains a different community");
    return { ...post, url: canonicalRedditPostUrl(post.url) };
  });
}

export async function readRedditThread(
  browser: RedditPageReader,
  input: { account: string },
) {
  z.string()
    .regex(/^[\w-]+$/)
    .parse(input.account);
  const url = new URL(await browser.currentUrl());
  if (url.hostname !== "old.reddit.com")
    throw new Error("Reddit discovery requires old Reddit thread rendering");
  const canonical = canonicalRedditPostUrl(url.href);
  await browser.snapshot({ selector: "#siteTable" });
  await browser.snapshot({ selector: ".commentarea" });
  const post = RedditRequestPostSchema.parse(
    await browser.evaluate(redditThreadScript(input.account)),
  );
  assertRedditPostIdentity(post);
  if (post.url.toLowerCase() !== canonical.toLowerCase())
    throw new Error("Reddit thread changed during discovery");
  return post;
}

export async function readRedditCommentReceipt(browser: RedditPageReader) {
  const url = new URL(await browser.currentUrl());
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[5];
  const modern = url.hostname === "www.reddit.com";
  if (
    id === undefined ||
    (!modern && url.hostname !== "old.reddit.com") ||
    parts[0] !== "r" ||
    parts[2] !== "comments" ||
    parts.length !== 6 ||
    !/^[a-z0-9]+$/.test(id)
  )
    throw new Error("Reddit reply receipt requires an exact comment permalink");
  const page = await browser.snapshot({
    selector: modern
      ? `shreddit-comment[thingid="t1_${id}"] [slot="comment"]`
      : `.thing.comment[data-fullname="t1_${id}"] > .entry`,
  });
  const comment = z
    .strictObject({
      id: z.string().regex(/^[a-z0-9]+$/),
      author: z.string().min(1),
      body: z.string().min(1),
      createdAt: z.iso.datetime({ offset: true }),
      parentId: z.string().regex(/^t[13]_[a-z0-9]+$/),
    })
    .parse(await browser.evaluate(redditCommentReceiptScript));
  if (comment.id !== id || (await browser.currentUrl()) !== url.href)
    throw new Error("Reddit reply receipt changed identity");
  return {
    ...page,
    text: comment.body,
    publishedAt: comment.createdAt,
    redditComment: comment,
  };
}
