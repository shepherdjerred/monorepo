import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Inbox, Plus, RotateCcw } from "lucide-react";
import { z } from "zod";
import { ForumKindSchema } from "#shared/forum.ts";
import { api, type BootstrapData } from "#client/data/api.ts";
import { useCurrentActor } from "#client/data/identity.ts";
import { useShell } from "#client/shell/shell-context.ts";
import { Empty, ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { expiryDelay, type ForumScopeItem, type Post } from "./data.ts";
import { ActiveNoticesStrip } from "./forum-notices-strip.tsx";
import {
  hasActiveForumFilters,
  noProjectFilterValue,
  readForumFilters,
  toForumListInput,
  updateForumParams,
  type ForumFilters,
} from "./forum-params.ts";
import { ForumThreadRow, useForumListKeyboard } from "./forum-row.tsx";
import { PostForm, type PostFormPrefill } from "./post-form.tsx";

function ForumFilterBar({
  filters,
  inboxCount,
  projects,
  scopes,
  onChange,
  onReset,
}: {
  filters: ForumFilters;
  inboxCount: number;
  projects: BootstrapData["projects"];
  scopes: readonly ForumScopeItem[];
  onChange: (changes: Record<string, string | null | undefined>) => void;
  onReset: () => void;
}) {
  const activeProjects = projects.filter(
    ({ archivedAt }) => archivedAt === null,
  );
  return (
    <search className="forum-filters" aria-label="Filter forum posts">
      <div className="forum-filter-top">
        <label className="forum-search-field" htmlFor="forum-search">
          <span>Search posts</span>
          <input
            id="forum-search"
            type="search"
            value={filters.query}
            placeholder="Search titles, replies, or FM-12…"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              onChange({ q: event.target.value });
            }}
          />
        </label>
        <div className="forum-quick-toggles">
          <button
            type="button"
            className={`forum-toggle-btn ${filters.inbox ? "is-active" : ""}`}
            aria-pressed={filters.inbox}
            onClick={() => {
              onChange({ inbox: filters.inbox ? null : "1" });
            }}
          >
            <Inbox size={14} aria-hidden="true" />
            <span>Inbox</span>
            {inboxCount > 0 && (
              <span className="forum-count-pill">{inboxCount}</span>
            )}
          </button>
          <button
            type="button"
            className={`forum-toggle-btn ${filters.unread ? "is-active" : ""}`}
            aria-pressed={filters.unread}
            onClick={() => {
              onChange({ unread: filters.unread ? null : "1" });
            }}
          >
            <span>Unread</span>
          </button>
          {hasActiveForumFilters(filters) && (
            <button
              type="button"
              className="forum-toggle-btn"
              onClick={onReset}
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>
      <div className="forum-filter-selects">
        <label htmlFor="forum-filter-kind">
          Type
          <select
            id="forum-filter-kind"
            value={filters.kind}
            onChange={(event) => {
              onChange({ kind: event.target.value });
            }}
          >
            <option value="">All types</option>
            <option value="notice">Notices</option>
            <option value="discussion">Discussions</option>
            <option value="question">Questions</option>
            <option value="decision">Decisions</option>
          </select>
        </label>
        <label htmlFor="forum-filter-status">
          Status
          <select
            id="forum-filter-status"
            value={filters.state}
            onChange={(event) => {
              onChange({ state: event.target.value });
            }}
          >
            <option value="active">Active</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="expired">Expired</option>
            <option value="answered">Answered</option>
            <option value="unanswered">Unanswered</option>
            <option value="pinned">Pinned</option>
            <option value="all">All history</option>
          </select>
        </label>
        <label htmlFor="forum-filter-project">
          Project
          <select
            id="forum-filter-project"
            value={filters.project}
            onChange={(event) => {
              onChange({ project: event.target.value });
            }}
          >
            <option value="">All projects</option>
            <option value={noProjectFilterValue}>No project</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="forum-filter-scope">
          Scope
          <input
            id="forum-filter-scope"
            list="forum-filter-scopes-datalist"
            value={filters.scope}
            placeholder="Any scope"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              onChange({ scope: event.target.value });
            }}
          />
          <datalist id="forum-filter-scopes-datalist">
            {scopes.map((item) => (
              <option key={item.scope} value={item.scope} />
            ))}
          </datalist>
        </label>
        <label htmlFor="forum-filter-sort">
          Sort
          <select
            id="forum-filter-sort"
            value={filters.sort}
            onChange={(event) => {
              onChange({ sort: event.target.value });
            }}
          >
            <option value="">Default</option>
            <option value="activity">Recent activity</option>
            <option value="newest">Newest</option>
            <option value="votes">Most votes</option>
            <option value="replies">Most replies</option>
          </select>
        </label>
      </div>
    </search>
  );
}

function ForumFeedResults({
  isPending,
  items,
  activeNotices,
  threadItems,
  total,
  writable,
  focused,
  setFocused,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  isPending: boolean;
  items: readonly Post[];
  activeNotices: readonly Post[];
  threadItems: readonly Post[];
  total: number;
  writable: boolean;
  focused: string | undefined;
  setFocused: (identifier: string) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  if (isPending) {
    return (
      <p role="status" className="muted">
        Loading posts…
      </p>
    );
  }
  return (
    <>
      <ActiveNoticesStrip
        notices={activeNotices}
        writable={writable}
        focused={focused}
        onFocusRow={setFocused}
      />
      <p className="forum-results-summary muted">
        {total} {total === 1 ? "post" : "posts"}
        {items.length < total ? ` · Showing ${String(items.length)}` : ""}
      </p>
      {threadItems.length > 0 && (
        <section aria-labelledby="forum-threads-heading">
          <h2 id="forum-threads-heading" className="sr-only">
            Threads
          </h2>
          <ul className="forum-thread-list" role="list">
            {threadItems.map((post) => (
              <ForumThreadRow
                key={post.id}
                post={post}
                focused={focused === post.identifier}
                onFocusRow={setFocused}
              />
            ))}
          </ul>
        </section>
      )}
      {hasNextPage && (
        <div className="forum-load-more">
          <button
            type="button"
            disabled={isFetchingNextPage}
            onClick={fetchNextPage}
          >
            {isFetchingNextPage ? "Loading…" : "Load more posts"}
          </button>
        </div>
      )}
      {items.length === 0 && (
        <Empty title="No posts match these filters">
          <p>Try broadening your search or switching status to All history.</p>
        </Empty>
      )}
    </>
  );
}

function readComposerPrefill(params: URLSearchParams): PostFormPrefill {
  const parsedKind = ForumKindSchema.safeParse(params.get("kind"));
  const issueIdentifier = params.get("issue")?.trim();
  const projectSlug = params.get("project")?.trim();
  return {
    ...(parsedKind.success ? { kind: parsedKind.data } : {}),
    ...(issueIdentifier === undefined || issueIdentifier === ""
      ? {}
      : { issueIdentifier }),
    ...(projectSlug === undefined || projectSlug === "" ? {} : { projectSlug }),
  };
}

export function Forum() {
  const { bootstrap } = useShell();
  const actor = useCurrentActor();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [focused, setFocused] = useState<string>();

  const legacyPost = params.get("post")?.trim() ?? "";
  const composeParam = params.get("compose") === "1";
  const composerOpen = bootstrap.writesEnabled && (creating || composeParam);
  const prefill = readComposerPrefill(params);
  const filters = readForumFilters(params);
  const input = toForumListInput(filters, actor.key);
  const queryActive = bootstrap.forumEnabled && legacyPost === "";

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
    enabled: queryActive,
  });

  const inbox = useQuery({
    queryKey: ["forum", "inbox-count", actor.key],
    queryFn: () =>
      api.forum.inbox.query({
        viewerActorKey: actor.key,
        unreadOnly: true,
        limit: 1,
      }),
    enabled: queryActive,
  });

  const scopes = useQuery({
    queryKey: ["forum", "scopes"],
    queryFn: () => api.forum.scopes.query(),
    enabled: queryActive,
  });

  const items = useMemo(
    () => posts.data?.pages.flatMap((page) => page.items) ?? [],
    [posts.data],
  );
  const showNoticesStrip =
    filters.query.trim() === "" &&
    (filters.state === "active" || filters.state === "open");
  const activeNotices = useMemo(
    () =>
      showNoticesStrip
        ? items.filter(
            (post) =>
              post.kind === "notice" && post.state === "open" && !post.expired,
          )
        : [],
    [items, showNoticesStrip],
  );
  const threadItems = useMemo(() => {
    const stripIds = new Set(activeNotices.map((notice) => notice.id));
    return items.filter((post) => !stripIds.has(post.id));
  }, [items, activeNotices]);

  const orderedIdentifiers = useMemo(
    () => [
      ...activeNotices.map((post) => post.identifier),
      ...threadItems.map((post) => post.identifier),
    ],
    [activeNotices, threadItems],
  );

  const keyboardRef = useForumListKeyboard({
    identifiers: orderedIdentifiers,
    focused,
    setFocused,
    navigate,
    writable: bootstrap.writesEnabled,
    openComposer: () => {
      setCreating(true);
    },
  });

  if (legacyPost !== "") {
    return <Navigate replace to={`/forum/${encodeURIComponent(legacyPost)}`} />;
  }

  if (!bootstrap.forumEnabled) {
    return (
      <div className="reading-page forum-page">
        <h1 tabIndex={-1}>Forum</h1>
        <p className="muted">The forum is currently disabled.</p>
      </div>
    );
  }

  function closeComposer() {
    setCreating(false);
    if (composeParam) {
      setParams(
        updateForumParams(params, { compose: null, issue: null, kind: null }),
        { replace: true },
      );
    }
  }

  return (
    <div className="reading-page forum-page" ref={keyboardRef}>
      <div className="forum-header">
        <div className="forum-header-copy">
          <h1 tabIndex={-1}>Forum</h1>
          <p className="muted">
            Coordinate across sessions — notices, questions, discussions, and
            decisions.
          </p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={!bootstrap.writesEnabled}
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus size={15} aria-hidden="true" />
          New post
        </button>
      </div>
      <ForumFilterBar
        filters={filters}
        inboxCount={inbox.data?.total ?? 0}
        projects={bootstrap.projects}
        scopes={scopes.data ?? []}
        onChange={(changes) => {
          setParams(updateForumParams(params, changes), { replace: true });
        }}
        onReset={() => {
          setParams(new URLSearchParams(), { replace: true });
        }}
      />
      {posts.error !== null && <ErrorNotice error={posts.error} />}
      <ForumFeedResults
        isPending={posts.isPending}
        items={items}
        activeNotices={activeNotices}
        threadItems={threadItems}
        total={posts.data?.pages[0]?.total ?? 0}
        writable={bootstrap.writesEnabled}
        focused={focused}
        setFocused={setFocused}
        hasNextPage={posts.hasNextPage}
        isFetchingNextPage={posts.isFetchingNextPage}
        fetchNextPage={() => {
          void posts.fetchNextPage();
        }}
      />
      <Modal
        title="New post"
        open={composerOpen}
        onClose={closeComposer}
        className="forum-composer-modal"
      >
        {composerOpen && (
          <PostForm
            prefill={prefill}
            close={closeComposer}
            created={(createdPost) => {
              void navigate(`/forum/${createdPost.identifier}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
