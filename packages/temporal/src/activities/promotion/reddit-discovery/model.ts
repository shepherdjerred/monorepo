import { z } from "zod/v4";

export const RedditListingPostSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+$/),
  subreddit: z.string().regex(/^\w+$/),
  url: z.url().startsWith("https://www.reddit.com/r/"),
  author: z.string().min(1),
  title: z.string().min(1).max(1000),
  createdAt: z.iso.datetime({ offset: true }),
});
export type RedditListingPost = z.infer<typeof RedditListingPostSchema>;

export const RedditRequestPostSchema = RedditListingPostSchema.extend({
  body: z.string().max(40_000),
  ownReplyIds: z.array(z.string().regex(/^[a-z0-9]+$/)),
  commentsComplete: z.boolean(),
  removed: z.boolean(),
  locked: z.boolean(),
  archived: z.boolean(),
  loggedInUsername: z.string().nullable(),
});
export type RedditRequestPost = z.infer<typeof RedditRequestPostSchema>;

export function canonicalRedditPostUrl(address: string): string {
  const url = new URL(address);
  const match = /^\/r\/(\w+)\/comments\/([a-z0-9]+)(?:\/|$)/.exec(url.pathname);
  if (
    match === null ||
    url.protocol !== "https:" ||
    !["www.reddit.com", "old.reddit.com"].includes(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  )
    throw new Error("Expected a canonical Reddit post URL");
  return `https://www.reddit.com/r/${String(match[1])}/comments/${String(match[2])}/`;
}

export function assertRedditPostIdentity(post: RedditListingPost): void {
  const canonical = canonicalRedditPostUrl(post.url);
  const expected = `https://www.reddit.com/r/${post.subreddit}/comments/${post.id}/`;
  if (canonical.toLowerCase() !== expected.toLowerCase())
    throw new Error("Reddit post identity does not match its permalink");
}
