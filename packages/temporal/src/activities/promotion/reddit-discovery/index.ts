import type { RedditOutreachSettings } from "#config/reddit-outreach.ts";
import type { PromotionBrowser } from "#activities/promotion/browser.ts";
import {
  assertRedditPostIdentity,
  type RedditListingPost,
  type RedditRequestPost,
} from "./model.ts";

export type RedditDiscoveryBrowser = Pick<
  PromotionBrowser,
  "open" | "readRedditListing" | "readRedditThread"
>;
type BrowserDiscoverySettings = Pick<
  RedditOutreachSettings,
  "subreddits" | "maxPostAgeHours"
> & {
  maxPostsPerSubreddit: number;
};

export function eligibleRedditRequest(
  post: RedditRequestPost,
  input: {
    now: number;
    maxPostAgeHours: number;
    account: string;
    alreadyHandled: ReadonlySet<string>;
  },
): boolean {
  assertRedditPostIdentity(post);
  const created = Date.parse(post.createdAt);
  return (
    Number.isFinite(created) &&
    created <= input.now &&
    created >= input.now - input.maxPostAgeHours * 60 * 60 * 1000 &&
    !input.alreadyHandled.has(post.id) &&
    post.ownReplyIds.length === 0 &&
    post.commentsComplete &&
    post.author !== "[deleted]" &&
    post.author.toLowerCase() !== input.account.toLowerCase() &&
    !post.removed &&
    !post.locked &&
    !post.archived
  );
}

/** Feed and thread failures propagate: an unreadable source is not an empty feed. */
export async function discoverRedditRequests(input: {
  browser: RedditDiscoveryBrowser;
  subreddit: string;
  settings: BrowserDiscoverySettings;
  now: number;
  alreadyHandled: ReadonlySet<string>;
  account: string;
  heartbeat?: () => void;
}): Promise<{ posts: RedditRequestPost[]; inspected: number }> {
  if (
    !input.settings.subreddits.some(
      (name) => name.toLowerCase() === input.subreddit.toLowerCase(),
    )
  )
    throw new Error("Reddit discovery community is not configured");
  const community = encodeURIComponent(input.subreddit);
  await input.browser.open(`https://old.reddit.com/r/${community}/new/`);
  const listing = await input.browser.readRedditListing({
    subreddit: input.subreddit,
    limit: input.settings.maxPostsPerSubreddit,
  });
  const posts: RedditRequestPost[] = [];
  let inspected = 0;
  const seen = new Set<string>();
  for (const item of listing) {
    assertRedditPostIdentity(item);
    if (!listingEligible(item, input) || seen.has(item.id)) continue;
    seen.add(item.id);
    input.heartbeat?.();
    const thread = new URL(item.url);
    thread.hostname = "old.reddit.com";
    await input.browser.open(thread.href);
    const post = await input.browser.readRedditThread({
      account: input.account,
    });
    inspected++;
    if (
      post.id !== item.id ||
      post.subreddit.toLowerCase() !== input.subreddit.toLowerCase()
    )
      throw new Error("Reddit feed and inspected thread identities differ");
    if (
      eligibleRedditRequest(post, {
        ...input,
        maxPostAgeHours: input.settings.maxPostAgeHours,
      })
    )
      posts.push(post);
  }
  return { posts, inspected };
}

function listingEligible(
  post: RedditListingPost,
  input: {
    now: number;
    settings: BrowserDiscoverySettings;
    alreadyHandled: ReadonlySet<string>;
    account: string;
  },
) {
  const created = Date.parse(post.createdAt);
  return (
    created <= input.now &&
    created >= input.now - input.settings.maxPostAgeHours * 60 * 60 * 1000 &&
    !input.alreadyHandled.has(post.id) &&
    post.author.toLowerCase() !== input.account.toLowerCase() &&
    post.author !== "[deleted]"
  );
}
