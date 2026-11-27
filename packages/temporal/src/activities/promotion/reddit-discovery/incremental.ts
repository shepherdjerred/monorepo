import type { RedditOutreachCoverage } from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import type { RedditPage } from "./pipeline.ts";
import {
  advanceRedditScanPage,
  openRedditScanWindow,
  restartRedditScanPage,
  settleRedditScanRows,
  type RedditCheckpointInput,
  type RedditScanCheckpoint,
  type RedditScanWindow,
} from "./checkpoint.ts";

type PostIdentity = { id: string; createdAt: string };
type Disposition = "scored" | "skipped";
type ProcessPage<Post> = {
  subreddit: string;
  posts: readonly Post[];
  since: number;
  until: number;
  settle: (ids: readonly string[], disposition?: Disposition) => Promise<void>;
};
export type RedditIncrementalInput<Post extends PostIdentity> = {
  store: PromotionStore;
  subreddits: readonly string[];
  preview: boolean;
  now: number;
  maxAgeHours: number;
  postLimit: number;
  pageLimit: number;
  signal: AbortSignal;
  readPage: (input: {
    subreddit: string;
    after: string | null;
    limit: number;
  }) => Promise<RedditPage<Post>>;
  process: (
    input: ProcessPage<Post>,
  ) => Promise<{ settledIds?: readonly string[]; stopReason?: string }>;
  shouldStop: () => string | undefined;
  isPinned?: (post: Post) => boolean;
  isExpiredCursor?: (error: unknown) => boolean;
  onInspected?: () => void;
  onCoverage?: (coverage: RedditOutreachCoverage) => void;
  onPost?: (post: Post) => void;
};
export type RedditIncrementalResult = {
  stopReason: string;
  inspected: number;
  pages: number;
  completedCommunities: string[];
};
type Community = {
  input: RedditCheckpointInput;
  checkpoint: RedditScanCheckpoint;
  restarted: boolean;
  coverage: RedditOutreachCoverage;
  discovered: Set<string>;
};
type Scan<Post extends PostIdentity> = {
  input: RedditIncrementalInput<Post>;
  result: RedditIncrementalResult;
  seen: Set<string>;
};

function scanStop<Post extends PostIdentity>({ input, result }: Scan<Post>) {
  if (input.signal.aborted) return "deadline";
  const requested = input.shouldStop();
  if (requested !== undefined) return requested;
  if (result.inspected >= input.postLimit) return "scan-limit";
  return result.pages >= input.pageLimit ? "listing-page-limit" : undefined;
}
function pending(community: Community): RedditScanWindow {
  const window = community.checkpoint.pending;
  if (window === null)
    throw new Error("Reddit community scan has no pending window");
  return window;
}
async function communities<Post extends PostIdentity>(
  input: RedditIncrementalInput<Post>,
) {
  const sources = new Map<string, Community>();
  for (const subreddit of input.subreddits) {
    const checkpointInput = {
      store: input.store,
      subreddit,
      preview: input.preview,
      now: input.now,
      maxAgeHours: input.maxAgeHours,
    };
    const checkpoint = await openRedditScanWindow(checkpointInput);
    const window = checkpoint.pending;
    if (window === null) throw new Error("Reddit scan window did not open");
    const coverage = {
      subreddit,
      since: window.since,
      until: window.until,
      found: 0,
      scored: 0,
      skipped: 0,
      pending: 0,
      complete: false,
    };
    sources.set(subreddit, {
      input: checkpointInput,
      checkpoint,
      restarted: false,
      coverage,
      discovered: new Set(),
    });
    input.onCoverage?.({ ...coverage });
  }
  return sources;
}

/** Freeze one recent window per community and resume unfinished pages before new work. */
export async function runIncrementalRedditDiscovery<Post extends PostIdentity>(
  input: RedditIncrementalInput<Post>,
): Promise<RedditIncrementalResult> {
  const result: RedditIncrementalResult = {
    stopReason: "exhausted",
    inspected: 0,
    pages: 0,
    completedCommunities: [],
  };
  const scan = { input, result, seen: new Set<string>() };
  if (scanStop(scan) !== undefined)
    return { ...result, stopReason: scanStop(scan) ?? "deadline" };
  const sources = await communities(input);
  while (sources.size > 0) {
    for (const [subreddit, community] of sources) {
      const stop = scanStop(scan);
      if (stop !== undefined) return { ...result, stopReason: stop };
      const outcome = await readCommunity(scan, community).finally(() => {
        community.coverage.complete = community.checkpoint.pending === null;
        input.onCoverage?.({ ...community.coverage });
      });
      if (community.checkpoint.pending === null) {
        sources.delete(subreddit);
        result.completedCommunities.push(subreddit);
      }
      if (outcome !== undefined) return { ...result, stopReason: outcome };
    }
  }
  return result;
}

async function readCommunity<Post extends PostIdentity>(
  scan: Scan<Post>,
  community: Community,
): Promise<string | undefined> {
  const { input, result } = scan;
  const window = pending(community);
  result.pages++;
  let page: RedditPage<Post>;
  try {
    page = await input.readPage({
      subreddit: community.input.subreddit,
      after: window.after,
      limit: 100,
    });
  } catch (error) {
    if (
      window.after === null ||
      community.restarted ||
      input.isExpiredCursor?.(error) !== true
    )
      throw error;
    community.checkpoint = await restartRedditScanPage(community.input, window);
    community.restarted = true;
    return;
  }
  return await processCommunityPage(scan, community, page);
}

function listingCreatedAt(post: PostIdentity) {
  const created = Date.parse(post.createdAt);
  if (!Number.isFinite(created))
    throw new TypeError("Reddit listing has an invalid creation time");
  return created;
}

function pageRows<Post extends PostIdentity>(
  scan: Scan<Post>,
  community: Community,
  page: RedditPage<Post>,
) {
  const { input, result, seen } = scan;
  const window = pending(community);
  const since = Date.parse(window.since);
  const until = Date.parse(window.until);
  const rows = new Map<string, Post>();
  let lastUnpinned = Number.POSITIVE_INFINITY;
  let newestFirst = true;
  let truncated = false;
  for (const post of page.posts) {
    const created = listingCreatedAt(post);
    if (input.isPinned?.(post) !== true) {
      newestFirst &&= created <= lastUnpinned;
      lastUnpinned = created;
    }
    if (created > until || community.checkpoint.settled[post.id] !== undefined)
      continue;
    if (!seen.has(post.id)) {
      if (result.inspected >= input.postLimit) {
        truncated = true;
        break;
      }
      seen.add(post.id);
      result.inspected++;
      input.onInspected?.();
    }
    if (created < since) continue;
    rows.set(post.id, post);
    if (!community.discovered.has(post.id)) {
      community.discovered.add(post.id);
      community.coverage.found++;
      community.coverage.pending++;
      input.onPost?.(post);
    }
  }
  const reachedCutoff = newestFirst && lastUnpinned < since;
  return { rows, since, until, reachedCutoff, truncated };
}

async function processCommunityPage<Post extends PostIdentity>(
  scan: Scan<Post>,
  community: Community,
  page: RedditPage<Post>,
): Promise<string | undefined> {
  const window = pending(community);
  const { rows, since, until, reachedCutoff, truncated } = pageRows(
    scan,
    community,
    page,
  );
  if (scan.input.signal.aborted) return "deadline";
  const stop = scan.input.shouldStop();
  if (stop !== undefined) return stop;
  const settle = async (
    ids: readonly string[],
    disposition: Disposition = "skipped",
  ) => {
    const settled = [...new Set(ids)].map((id) => {
      const row = rows.get(id);
      if (row === undefined)
        throw new Error(
          "Reddit processor settled a row outside its current page",
        );
      return { id, createdAt: row.createdAt };
    });
    const newSettlements = settled.filter(
      ({ id }) => community.checkpoint.settled[id] === undefined,
    ).length;
    community.checkpoint = await settleRedditScanRows(
      community.input,
      window,
      settled,
    );
    community.coverage[disposition] += newSettlements;
    community.coverage.pending -= newSettlements;
  };
  const processed =
    rows.size === 0
      ? {}
      : await scan.input.process({
          subreddit: community.input.subreddit,
          posts: [...rows.values()],
          since,
          until,
          settle,
        });
  if (processed.settledIds !== undefined) await settle(processed.settledIds);
  if (
    [...rows.keys()].some(
      (id) => community.checkpoint.settled[id] === undefined,
    )
  )
    return processed.stopReason ?? "unsettled-page";
  if (truncated) return processed.stopReason ?? "scan-limit";
  const next = reachedCutoff ? null : page.after;
  community.checkpoint = await advanceRedditScanPage(
    community.input,
    window,
    next,
  );
  return processed.stopReason;
}
