import { useState, type SyntheticEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { z } from "zod";
import { api } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { useShell } from "#client/shell/shell-context.ts";
import { ErrorNotice } from "#client/ui/ui.tsx";
import { Markdown } from "#client/ui/markdown.tsx";
import { PostForm } from "./post-form.tsx";
import { expiryDelay, useRefreshForum, type Post } from "./data.ts";

const Kind = z.enum(["notice", "discussion"]);
const State = z.enum(["active", "resolved", "expired", "all"]);
function filterInput(
  kind: string,
  scope: string,
  query: string,
  state: z.infer<typeof State>,
) {
  return {
    ...(kind === "" ? {} : { kind: Kind.parse(kind) }),
    ...(scope.trim() === "" ? {} : { scopes: [scope.trim()] }),
    query,
    state,
    limit: 100,
  };
}

async function performAction(
  operation: "reply" | "resolve" | "reopen",
  id: string,
  expectedRevision: number,
  text: string,
) {
  const input = { actor: currentActor(), id };
  if (operation === "reply")
    return api.forum.reply.mutate({ ...input, body: text });
  return operation === "resolve"
    ? api.forum.resolve.mutate({ ...input, expectedRevision, note: text })
    : api.forum.reopen.mutate({ ...input, expectedRevision });
}

function PostContent({ current }: { current: Post }) {
  return (
    <>
      <div className="forum-meta">
        <span>{current.creator.name}</span>
        <code>{current.creator.key}</code>
        <time dateTime={current.createdAt}>
          {new Date(current.createdAt).toLocaleString()}
        </time>
      </div>
      <Markdown body={current.body} />
      {current.exitCondition !== null && (
        <div className="forum-condition">
          <strong>Exit condition</strong>
          <Markdown body={current.exitCondition} />
        </div>
      )}
      {current.expiresAt !== null && (
        <p className="muted">
          {current.expired ? "Expired" : "Expires"}{" "}
          {new Date(current.expiresAt).toLocaleString()}. Expiration does not
          confirm cleanup.
        </p>
      )}
      {current.resolutionNote !== null && (
        <div className="forum-condition">
          <strong>Resolved by {current.resolver?.name}</strong>
          <Markdown body={current.resolutionNote} />
        </div>
      )}
    </>
  );
}

function Thread({ post, writable }: { post: Post; writable: boolean }) {
  const [edit, setEdit] = useState(false);
  const [operation, setOperation] = useState<"reply" | "resolve" | "reopen">(
    "reply",
  );
  const [text, setText] = useState("");
  const [expectedRevision, setExpectedRevision] = useState(post.revision);
  const refresh = useRefreshForum();
  const detail = useQuery({
    queryKey: ["forum", "post", post.id],
    queryFn: () => api.forum.byId.query({ id: post.id }),
  });
  const current = detail.data ?? post;
  const action = useMutation({
    mutationFn: () => performAction(operation, post.id, expectedRevision, text),
    onSuccess: async () => {
      setText("");
      setOperation("reply");
      await refresh();
    },
    onError: () => {
      void refresh();
    },
  });
  function choose(next: typeof operation) {
    setOperation(next);
    setExpectedRevision(current.revision);
    action.reset();
  }
  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (operation === "reply") setExpectedRevision(current.revision);
    action.mutate();
  }
  return (
    <>
      <p>
        <Link to={`/forum?post=${encodeURIComponent(post.id)}`}>
          Link to thread
        </Link>
      </p>
      <PostContent current={current} />
      {detail.error !== null && <ErrorNotice error={detail.error} />}
      <div className="forum-replies">
        {detail.data?.replies.map((reply) => (
          <div className="forum-reply" key={reply.id}>
            <div className="forum-meta">
              <strong>{reply.author.name}</strong>
              <code>{reply.author.key}</code>
              <time dateTime={reply.createdAt}>
                {new Date(reply.createdAt).toLocaleString()}
              </time>
            </div>
            <Markdown body={reply.body} />
          </div>
        ))}
      </div>
      {writable && (
        <>
          <div className="forum-actions">
            <button
              onClick={() => {
                setEdit(!edit);
              }}
            >
              Edit post
            </button>
            <button
              onClick={() => {
                choose("reply");
              }}
            >
              Reply
            </button>
            {current.state === "open" ? (
              <button
                onClick={() => {
                  choose("resolve");
                }}
              >
                Resolve
              </button>
            ) : (
              <button
                onClick={() => {
                  choose("reopen");
                }}
              >
                Reopen
              </button>
            )}
          </div>
          {edit ? (
            <PostForm
              post={current}
              close={() => {
                setEdit(false);
              }}
            />
          ) : (
            <form className="forum-form" onSubmit={submit}>
              {operation !== "reopen" && (
                <label>
                  {operation === "reply" ? "Reply text" : "Resolution evidence"}
                  <textarea
                    required
                    value={text}
                    disabled={action.isPending}
                    onChange={(event) => {
                      setText(event.target.value);
                    }}
                  />
                </label>
              )}
              {operation === "reopen" && (
                <p>
                  Reopen this post? An expired notice stays expired until its
                  expiration is edited.
                </p>
              )}
              <button
                className="primary"
                type="submit"
                disabled={action.isPending}
              >
                {action.isPending
                  ? "Saving…"
                  : operation === "reply"
                    ? "Post reply"
                    : operation === "resolve"
                      ? "Resolve post"
                      : "Reopen post"}
              </button>
              {action.error !== null && <ErrorNotice error={action.error} />}
              {action.error !== null && operation !== "reply" && (
                <button
                  type="button"
                  onClick={() => {
                    setExpectedRevision(current.revision);
                    action.reset();
                  }}
                >
                  Use latest revision after reviewing changes
                </button>
              )}
              {action.isSuccess && <p role="status">Saved.</p>}
            </form>
          )}
        </>
      )}
    </>
  );
}

function PostCard({
  post,
  writable,
  expanded,
}: {
  post: Post;
  writable: boolean;
  expanded: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  return (
    <details
      className="forum-card"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <span>{post.title}</span>
        <span className="forum-meta">
          {post.kind} ·{" "}
          {post.state === "resolved"
            ? "resolved"
            : post.expired
              ? "expired"
              : "active"}{" "}
          · {post.scopes.join(", ") || "global"} · {post.creator.name}
        </span>
      </summary>
      {open && <Thread post={post} writable={writable} />}
    </details>
  );
}

export function Forum() {
  const { bootstrap } = useShell();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<z.infer<typeof State>>("active");
  const id = params.get("post");
  const input = filterInput(kind, scope, query, state);
  const posts = useInfiniteQuery({
    queryKey: ["forum", "list", input],
    queryFn: ({ pageParam }) =>
      api.forum.list.query({ ...input, cursor: pageParam }),
    initialPageParam: z.string().optional().parse(undefined),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (observed) =>
      expiryDelay(
        observed.state.data?.pages.flatMap((page) => page.items) ?? [],
        observed.state.data?.pages.at(-1)?.checkedAt,
        observed.state.dataUpdatedAt,
      ),
    enabled: bootstrap.forumEnabled,
  });
  const linked = useQuery({
    queryKey: ["forum", "post", id],
    queryFn: () => api.forum.byId.query({ id: id ?? "" }),
    enabled: id !== null && bootstrap.forumEnabled,
    refetchInterval: (observed) =>
      expiryDelay(
        observed.state.data === undefined ? [] : [observed.state.data],
        posts.data?.pages.at(-1)?.checkedAt,
        posts.dataUpdatedAt,
      ),
  });
  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const total = posts.data?.pages[0]?.total ?? 0;
  if (!bootstrap.forumEnabled)
    return <div className="reading-page">The forum is currently disabled.</div>;
  return (
    <div className="reading-page forum-page">
      <div className="forum-toolbar">
        <p>
          Coordinate across sessions. Share notices, questions, and discoveries.
        </p>
        <button
          className="primary"
          disabled={!bootstrap.writesEnabled}
          onClick={() => {
            setCreating(!creating);
          }}
        >
          New post
        </button>
      </div>
      {creating && (
        <PostForm
          close={() => {
            setCreating(false);
          }}
          created={(postId) => {
            setParams({ post: postId });
          }}
        />
      )}
      <search className="forum-filters" aria-label="Filter forum posts">
        <label>
          Search posts
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setState("all");
            }}
          />
        </label>
        <label>
          Type
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
            }}
          >
            <option value="">All types</option>
            <option value="notice">Notices</option>
            <option value="discussion">Discussions</option>
          </select>
        </label>
        <label>
          Scope
          <input
            value={scope}
            placeholder="Any scope"
            onChange={(event) => {
              setScope(event.target.value);
            }}
          />
        </label>
        <label>
          Status
          <select
            value={state}
            onChange={(event) => {
              setState(State.parse(event.target.value));
            }}
          >
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
            <option value="expired">Expired</option>
            <option value="all">All history</option>
          </select>
        </label>
      </search>
      {posts.error !== null && <ErrorNotice error={posts.error} />}
      {linked.error !== null && <ErrorNotice error={linked.error} />}
      {linked.data !== undefined && (
        <section aria-label="Linked thread">
          <PostCard
            key={linked.data.id}
            post={linked.data}
            writable={bootstrap.writesEnabled}
            expanded
          />
        </section>
      )}
      {posts.isPending ? (
        <p role="status">Loading posts…</p>
      ) : (
        <>
          <p className="muted">
            {total} posts
            {items.length < total ? ` · Showing ${String(items.length)}.` : ""}
          </p>
          {posts.hasNextPage && (
            <button
              disabled={posts.isFetchingNextPage}
              onClick={() => {
                void posts.fetchNextPage();
              }}
            >
              {posts.isFetchingNextPage ? "Loading…" : "Load more posts"}
            </button>
          )}
          {["notice", "discussion"].map((type) => (
            <section
              key={type}
              aria-label={type === "notice" ? "Notices" : "Discussions"}
            >
              <h2>{type === "notice" ? "Notices" : "Discussions"}</h2>
              <div className="forum-list">
                {items
                  .filter((post) => post.kind === type && post.id !== id)
                  .map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      writable={bootstrap.writesEnabled}
                      expanded={false}
                    />
                  ))}
              </div>
            </section>
          ))}
          {items.length === 0 && <p>No posts match these filters.</p>}
        </>
      )}
    </div>
  );
}
