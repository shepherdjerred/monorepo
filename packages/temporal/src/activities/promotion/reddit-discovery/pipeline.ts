export type RedditPage<Post> = {
  posts: readonly Post[];
  after: string | null;
};

type PostIdentity = { id: string; createdAt: string };
type Ranked<Post, Qualification> = {
  post: Post;
  qualification: Qualification;
  score: number;
};
type SweepLimit = "reply-limit" | "scan-limit" | "exhausted" | "deadline";

type DiscoveryInput<Post, Qualification> = {
  subreddits: readonly string[];
  postLimit: number;
  replyLimit: number;
  since: number;
  now: number;
  signal: AbortSignal;
  readPage: (input: {
    subreddit: string;
    after: string | null;
    limit: number;
  }) => Promise<RedditPage<Post>>;
  candidates: (
    posts: readonly Post[],
  ) => Promise<Ranked<Post, Qualification>[]>;
  handle: (candidate: Ranked<Post, Qualification>) => Promise<boolean>;
  onInspected: () => void;
};
type PageCursor = { after: string | null; used: Set<string> };

/** Scan one page per community per round and score small batches for early exit. */
export async function runRedditDiscovery<
  Post extends PostIdentity,
  Qualification,
>(input: DiscoveryInput<Post, Qualification>): Promise<SweepLimit> {
  const pages = new Map<string, PageCursor>(
    input.subreddits.map((subreddit) => [
      subreddit,
      { after: null, used: new Set() },
    ]),
  );
  const seen = new Set<string>();
  const ranked: Ranked<Post, Qualification>[] = [];
  let handled = 0;
  const done = () => input.signal.aborted || handled >= input.replyLimit;
  const morePages = () =>
    !done() && seen.size < input.postLimit && pages.size > 0;

  const flush = async () => {
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.post.createdAt) - Date.parse(a.post.createdAt),
    );
    for (const candidate of ranked.splice(0)) {
      if (done()) return;
      if (await input.handle(candidate)) handled++;
    }
  };
  const score = async (posts: readonly Post[]) => {
    for (let offset = 0; offset < posts.length && !done(); offset += 8) {
      ranked.push(...(await input.candidates(posts.slice(offset, offset + 8))));
      if (ranked.length >= input.replyLimit - handled) await flush();
    }
  };

  while (morePages()) {
    for (const [subreddit, cursor] of pages) {
      if (!morePages()) break;
      const { posts, hasMore } = await readCommunityPage(
        input,
        subreddit,
        cursor,
        seen,
      );
      if (!hasMore) pages.delete(subreddit);
      await score(posts);
    }
  }
  await flush();
  if (input.signal.aborted) return "deadline";
  if (handled >= input.replyLimit) return "reply-limit";
  return seen.size >= input.postLimit ? "scan-limit" : "exhausted";
}

async function readCommunityPage<Post extends PostIdentity, Qualification>(
  input: DiscoveryInput<Post, Qualification>,
  subreddit: string,
  cursor: PageCursor,
  seen: Set<string>,
) {
  const limit = Math.min(100, input.postLimit - seen.size);
  const page = await input.readPage({ subreddit, after: cursor.after, limit });
  const { posts, reachedCutoff } = freshPage(page.posts, {
    ...input,
    seen,
    limit,
  });
  if (reachedCutoff || page.after === null || page.posts.length === 0)
    return { posts, hasMore: false };
  if (cursor.used.has(page.after))
    throw new Error("Reddit listing repeated its pagination cursor");
  cursor.used.add(page.after);
  cursor.after = page.after;
  return { posts, hasMore: true };
}

function freshPage<Post extends PostIdentity>(
  page: readonly Post[],
  input: {
    seen: Set<string>;
    limit: number;
    since: number;
    now: number;
    onInspected: () => void;
  },
) {
  const posts: Post[] = [];
  let reachedCutoff = false;
  for (const post of page.slice(0, input.limit)) {
    if (input.seen.has(post.id)) continue;
    input.seen.add(post.id);
    input.onInspected();
    const date = Date.parse(post.createdAt);
    if (date < input.since) reachedCutoff = true;
    if (date >= input.since && date <= input.now) posts.push(post);
  }
  return { posts, reachedCutoff };
}
