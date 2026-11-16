import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router";
import { Check } from "lucide-react";
import { api, queryClient, type BootstrapData } from "#client/data/api.ts";
import { currentActor, useCurrentActor } from "#client/data/identity.ts";
import { useViewTransitions } from "#client/feedback/motion.ts";
import { useShell } from "#client/shell/shell-context.ts";
import { Markdown } from "#client/ui/markdown.tsx";
import { ActivitySkeleton } from "#client/ui/skeleton.tsx";
import { AbsoluteTime, RelativeTime } from "#client/ui/time.tsx";
import { Avatar, ErrorNotice, Modal } from "#client/ui/ui.tsx";
import {
  expiryDelay,
  forumPostKey,
  useRefreshForum,
  type PostDetail,
} from "./data.ts";
import {
  ForumAttachments,
  ForumKindBadge,
  ForumPinnedBadge,
  ForumStatusBadge,
} from "./forum-badges.tsx";
import {
  HandoffNoticeModal,
  LinkIssueModal,
  PromoteToIssueModal,
  type PromoteTarget,
} from "./forum-modals.tsx";
import { ForumRepliesSection } from "./forum-replies.tsx";
import {
  ThreadEngagementBar,
  ThreadPropertiesRail,
} from "./forum-thread-rail.tsx";
import { PostForm } from "./post-form.tsx";

function ThreadCallouts({ post }: { post: PostDetail }) {
  const acceptedReply =
    post.kind === "question" && post.acceptedReplyId !== null
      ? post.replies.find(
          (reply) => reply.id === post.acceptedReplyId && !reply.deleted,
        )
      : undefined;
  return (
    <>
      {post.exitCondition !== null && (
        <div className="forum-callout forum-callout-condition">
          <h2>Exit condition</h2>
          <Markdown body={post.exitCondition} />
        </div>
      )}
      {post.expiresAt !== null && (
        <div
          className={`forum-callout ${post.expired ? "forum-callout-expired" : "forum-callout-expiry"}`}
        >
          <strong>
            {post.expired ? "Expired" : "Expires"}{" "}
            <AbsoluteTime value={post.expiresAt} withTime />
          </strong>
          <p className="muted">Expiration does not confirm cleanup.</p>
        </div>
      )}
      {post.resolutionNote !== null && (
        <div className="forum-callout forum-callout-resolved">
          <strong>Resolved by {post.resolver?.name ?? "Unknown"}</strong>
          <Markdown body={post.resolutionNote} />
        </div>
      )}
      {acceptedReply !== undefined && (
        <div className="forum-callout forum-callout-accepted">
          <div className="forum-accepted-header">
            <span className="forum-badge is-answered">
              <Check size={11} aria-hidden="true" />
              Accepted answer
            </span>
            <Avatar actor={acceptedReply.author} decorative />
            <span>{acceptedReply.author.name}</span>
            <a href={`#reply-${acceptedReply.id}`} className="forum-jump-link">
              Jump to answer
            </a>
          </div>
          <Markdown body={acceptedReply.body} />
        </div>
      )}
    </>
  );
}

function ResolutionForm({
  post,
  mode,
  onDone,
}: {
  post: PostDetail;
  mode: "resolve" | "reopen";
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [expectedRevision, setExpectedRevision] = useState(post.revision);
  const refresh = useRefreshForum();
  const mutateState = useMutation({
    mutationFn: () =>
      mode === "resolve"
        ? api.forum.resolve.mutate({
            actor: currentActor(),
            id: post.id,
            expectedRevision,
            note,
          })
        : api.forum.reopen.mutate({
            actor: currentActor(),
            id: post.id,
            expectedRevision,
          }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
    onError: () => {
      void refresh();
    },
  });
  const submitLabel = mutateState.isPending
    ? "Saving…"
    : mode === "resolve"
      ? "Resolve post"
      : "Reopen post";
  return (
    <form
      className="forum-resolution-form"
      onSubmit={(event) => {
        event.preventDefault();
        mutateState.mutate();
      }}
    >
      {mode === "resolve" ? (
        <label htmlFor="forum-resolution-note">
          Resolution evidence
          <textarea
            id="forum-resolution-note"
            required
            value={note}
            disabled={mutateState.isPending}
            placeholder="Record the verification or cleanup evidence…"
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
      ) : (
        <p className="muted">
          Reopen this post? An expired notice stays expired until its expiration
          is edited.
        </p>
      )}
      {mutateState.error !== null && <ErrorNotice error={mutateState.error} />}
      {mutateState.error !== null && (
        <button
          type="button"
          onClick={() => {
            setExpectedRevision(post.revision);
            mutateState.reset();
          }}
        >
          Use latest revision after reviewing changes
        </button>
      )}
      <div className="forum-actions">
        <button
          type="submit"
          className="primary"
          disabled={mutateState.isPending}
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

async function markPostReadAndRefresh(
  postId: string,
  refresh: () => Promise<unknown>,
) {
  try {
    await api.forum.markRead.mutate({ actor: currentActor(), id: postId });
    await refresh();
  } catch {
    // Best-effort read state sync.
  }
}

function ForumThreadModals({
  post,
  bootstrap,
  editing,
  setEditing,
  handoffOpen,
  setHandoffOpen,
  linkIssueOpen,
  setLinkIssueOpen,
  promoteTarget,
  setPromoteTarget,
}: {
  post: PostDetail;
  bootstrap: BootstrapData;
  editing: boolean;
  setEditing: (open: boolean) => void;
  handoffOpen: boolean;
  setHandoffOpen: (open: boolean) => void;
  linkIssueOpen: boolean;
  setLinkIssueOpen: (open: boolean) => void;
  promoteTarget: PromoteTarget | undefined;
  setPromoteTarget: (target: PromoteTarget | undefined) => void;
}) {
  return (
    <>
      <Modal
        title={`Edit ${post.identifier}`}
        open={editing}
        onClose={() => {
          setEditing(false);
        }}
        className="forum-composer-modal"
      >
        {editing && (
          <PostForm
            post={post}
            close={() => {
              setEditing(false);
            }}
          />
        )}
      </Modal>
      {handoffOpen && (
        <HandoffNoticeModal
          open
          onClose={() => {
            setHandoffOpen(false);
          }}
          post={post}
          bootstrap={bootstrap}
        />
      )}
      {linkIssueOpen && (
        <LinkIssueModal
          open
          onClose={() => {
            setLinkIssueOpen(false);
          }}
          post={post}
        />
      )}
      {promoteTarget !== undefined && (
        <PromoteToIssueModal
          open
          onClose={() => {
            setPromoteTarget(undefined);
          }}
          post={post}
          target={promoteTarget}
          bootstrap={bootstrap}
        />
      )}
    </>
  );
}

function ForumThreadContent({
  post,
  bootstrap,
}: {
  post: PostDetail;
  bootstrap: BootstrapData;
}) {
  const actor = useCurrentActor();
  const refresh = useRefreshForum();
  const viewTransition = useViewTransitions();
  const writable = bootstrap.writesEnabled;

  const [editing, setEditing] = useState(false);
  const [stateMode, setStateMode] = useState<"resolve" | "reopen">();
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [linkIssueOpen, setLinkIssueOpen] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<PromoteTarget>();

  const markedStampRef = useRef<string | undefined>(undefined);
  const stamp = `${post.id}:${post.lastActivityAt}:${actor.key}`;
  const markReadRef = useCallback(
    (element: HTMLElement | null) => {
      if (element === null || !writable || !post.unread) return;
      if (markedStampRef.current === stamp) return;
      markedStampRef.current = stamp;
      void markPostReadAndRefresh(post.id, refresh);
    },
    [writable, post.unread, post.id, stamp, refresh],
  );

  return (
    <article className="issue-detail forum-thread-detail" ref={markReadRef}>
      <header className="detail-toolbar">
        <nav className="forum-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/forum" viewTransition={viewTransition}>
                Forum
              </Link>
            </li>
            <li>
              <Link
                to={`/forum/${post.identifier}`}
                aria-current="page"
                className="identifier"
              >
                {post.identifier}
              </Link>
            </li>
          </ol>
        </nav>
      </header>
      <div className="detail-grid">
        <div className="detail-main forum-thread-main">
          <div className="forum-thread-badges">
            {post.pinnedAt !== null && <ForumPinnedBadge />}
            <ForumKindBadge kind={post.kind} />
            <ForumStatusBadge post={post} />
          </div>
          <h1 tabIndex={-1} className="forum-thread-title">
            {post.title}
          </h1>
          <div className="forum-author-bar">
            <Avatar actor={post.creator} decorative />
            <strong>{post.creator.name}</strong>
            <code className="identifier">{post.creator.key}</code>
            <RelativeTime value={post.createdAt} className="muted" />
            {post.editedAt !== null && <span className="muted">(edited)</span>}
          </div>
          <div className="forum-post-body">
            <Markdown body={post.body} />
          </div>
          <ForumAttachments files={post.attachments} />
          <ThreadCallouts post={post} />
          <ThreadEngagementBar
            post={post}
            writable={writable}
            onEdit={() => {
              setEditing(true);
            }}
            onStateAction={(mode) => {
              setStateMode((current) => (current === mode ? undefined : mode));
            }}
          />
          {writable && stateMode !== undefined && (
            <ResolutionForm
              key={`${post.id}:${stateMode}:${String(post.revision)}`}
              post={post}
              mode={stateMode}
              onDone={() => {
                setStateMode(undefined);
              }}
            />
          )}
          <ForumRepliesSection
            post={post}
            writable={writable}
            onPromote={setPromoteTarget}
          />
        </div>
        <ThreadPropertiesRail
          post={post}
          bootstrap={bootstrap}
          writable={writable}
          onHandoff={() => {
            setHandoffOpen(true);
          }}
          onLinkIssue={() => {
            setLinkIssueOpen(true);
          }}
          onPromote={setPromoteTarget}
        />
      </div>
      <ForumThreadModals
        post={post}
        bootstrap={bootstrap}
        editing={editing}
        setEditing={setEditing}
        handoffOpen={handoffOpen}
        setHandoffOpen={setHandoffOpen}
        linkIssueOpen={linkIssueOpen}
        setLinkIssueOpen={setLinkIssueOpen}
        promoteTarget={promoteTarget}
        setPromoteTarget={setPromoteTarget}
      />
    </article>
  );
}

export function ForumThreadPage() {
  const { bootstrap } = useShell();
  const actor = useCurrentActor();
  const rawIdentifier = useParams()["identifier"] ?? "";

  const detail = useQuery({
    queryKey: forumPostKey(rawIdentifier, actor.key),
    queryFn: () =>
      api.forum.byId.query({ id: rawIdentifier, viewerActorKey: actor.key }),
    enabled: bootstrap.forumEnabled && rawIdentifier !== "",
    refetchInterval: (observed) =>
      expiryDelay(
        observed.state.data === undefined ? [] : [observed.state.data],
        observed.state.data === undefined
          ? undefined
          : new Date(observed.state.dataUpdatedAt).toISOString(),
        observed.state.dataUpdatedAt,
      ),
  });

  if (!bootstrap.forumEnabled) {
    return (
      <div className="reading-page forum-page">
        <h1 tabIndex={-1}>Forum</h1>
        <p className="muted">The forum is currently disabled.</p>
      </div>
    );
  }

  if (detail.error !== null) {
    return (
      <div className="reading-page forum-page">
        <h1 tabIndex={-1}>Forum</h1>
        <ErrorNotice error={detail.error} />
      </div>
    );
  }

  if (detail.data === undefined) {
    return (
      <div className="reading-page forum-page">
        <ActivitySkeleton />
      </div>
    );
  }

  if (rawIdentifier !== detail.data.identifier) {
    queryClient.setQueryData(
      forumPostKey(detail.data.identifier, actor.key),
      detail.data,
    );
    return <Navigate replace to={`/forum/${detail.data.identifier}`} />;
  }

  return <ForumThreadContent post={detail.data} bootstrap={bootstrap} />;
}
