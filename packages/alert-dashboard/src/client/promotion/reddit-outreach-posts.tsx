import { useInfiniteQuery } from "@tanstack/react-query";
import {
  RedditOutreachPostPageSchema,
  RedditOutreachReasonSchema,
  type RedditOutreachPost,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { redditOutreachReasonLabels } from "./reddit-outreach-reasons.ts";
import { LinkOut } from "./ui.tsx";

const resultLabels = {
  pending: "Pending",
  skipped: "Skipped",
  "no-match": "No match",
  "draft-rejected": "Draft rejected",
  "draft-ready": "Draft ready",
  "publish-verified": "Reply verified",
  "publish-blocked": "Publishing blocked",
  "publish-duplicate": "Already replied",
  "publish-deferred": "Publishing deferred",
} satisfies Record<RedditOutreachPost["result"], string>;

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

function formatReason(reason: string) {
  const code = RedditOutreachReasonSchema.safeParse(reason);
  return code.success ? redditOutreachReasonLabels[code.data] : reason;
}

export function OutreachRunPosts({ runId }: { runId: string }) {
  const query = useInfiniteQuery({
    queryKey: ["promotion", "reddit-posts", runId],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ runId, offset: String(pageParam) });
      const response = await fetch(`/api/v1/promotion/reddit-posts?${params}`, {
        signal,
      });
      // During a rolling upgrade an older producer can still serve the overview.
      if (response.status === 404) return { status: "unavailable" } as const;
      if (!response.ok) throw new Error("Could not read individual posts.");
      return RedditOutreachPostPageSchema.parse(await response.json());
    },
    getNextPageParam: (last) =>
      last.status === "available" ? (last.nextOffset ?? undefined) : undefined,
  });
  if (query.isPending) return <p role="status">Reading individual posts…</p>;
  if (query.data === undefined) {
    return (
      <>
        <p role="alert">Could not read individual posts.</p>
        <button type="button" onClick={() => void query.refetch()}>
          Retry
        </button>
      </>
    );
  }
  if (query.data.pages[0]?.status === "unavailable") {
    return (
      <p className="p-muted">Individual posts unavailable for this run.</p>
    );
  }
  const posts = query.data.pages.flatMap((page) =>
    page.status === "available" ? page.posts : [],
  );
  if (posts.length === 0) {
    return (
      <p className="p-muted">No individual posts recorded for this run.</p>
    );
  }
  return (
    <>
      <ul className="p-outreach-coverage-list" role="list">
        {posts.map((post) => (
          <li key={post.id}>
            <LinkOut url={post.url} label={post.title} />
            <span className="p-muted p-outreach-coverage-window">
              r/{post.subreddit} · {resultLabels[post.result]} ·{" "}
              {post.score === null ? "Not scored" : percent.format(post.score)}
            </span>
            {post.reason !== null && <p>{formatReason(post.reason)}</p>}
          </li>
        ))}
      </ul>
      {query.isFetchNextPageError && (
        <p role="alert">Could not read more posts.</p>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Reading posts…" : "Load more posts"}
        </button>
      )}
    </>
  );
}
