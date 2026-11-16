import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { Bell, BellOff, Pencil, Pin, ThumbsUp, Trash2 } from "lucide-react";
import type { ForumEmoji } from "#shared/forum.ts";
import { api, queryClient, type BootstrapData } from "#client/data/api.ts";
import { eventsKey, issueKey } from "#client/data/cache.ts";
import { currentActor, useCurrentActor } from "#client/data/identity.ts";
import { useViewTransitions } from "#client/feedback/motion.ts";
import { StateIcon } from "#client/ui/icons.tsx";
import { notify, notifyError } from "#client/ui/toast.tsx";
import { ActorChip, Swatch } from "#client/ui/ui.tsx";
import { useRefreshForum, type PostDetail } from "./data.ts";
import { EmojiReactionBar } from "./forum-badges.tsx";
import type { PromoteTarget } from "./forum-modals.tsx";

export function ThreadEngagementBar({
  post,
  writable,
  onEdit,
  onStateAction,
}: {
  post: PostDetail;
  writable: boolean;
  onEdit: () => void;
  onStateAction: (mode: "resolve" | "reopen") => void;
}) {
  const refresh = useRefreshForum();
  const vote = useMutation({
    mutationFn: () =>
      api.forum.vote.mutate({
        actor: currentActor(),
        id: post.id,
        remove: post.viewerVoted,
      }),
    onSuccess: () => refresh(),
  });
  const react = useMutation({
    mutationFn: ({ emoji, remove }: { emoji: ForumEmoji; remove: boolean }) =>
      api.forum.react.mutate({
        actor: currentActor(),
        id: post.id,
        emoji,
        remove,
      }),
    onSuccess: () => refresh(),
  });
  const subscribe = useMutation({
    mutationFn: (mode: "subscribed" | "muted" | null) =>
      api.forum.subscribe.mutate({
        actor: currentActor(),
        id: post.id,
        mode,
      }),
    onSuccess: () => refresh(),
  });
  const pin = useMutation({
    mutationFn: () =>
      api.forum.pin.mutate({
        actor: currentActor(),
        id: post.id,
        pinned: post.pinnedAt === null,
      }),
    onSuccess: () => refresh(),
  });

  const isSubscribed = post.viewerSubscription === "subscribed";
  const isMuted = post.viewerSubscription === "muted";

  return (
    <div className="forum-engagement-bar">
      <button
        type="button"
        className={`forum-pill-btn ${post.viewerVoted ? "is-active" : ""}`}
        aria-pressed={post.viewerVoted}
        disabled={!writable || vote.isPending}
        onClick={() => {
          vote.mutate();
        }}
      >
        <ThumbsUp size={13} aria-hidden="true" />
        <span>Upvote</span>
        <span className="count">{post.voteCount}</span>
      </button>
      <EmojiReactionBar
        reactions={post.reactions}
        writable={writable}
        disabled={react.isPending}
        onToggle={(emoji, remove) => {
          react.mutate({ emoji, remove });
        }}
      />
      <button
        type="button"
        className={`forum-pill-btn ${isSubscribed ? "is-active" : ""}`}
        aria-pressed={isSubscribed}
        disabled={!writable || subscribe.isPending}
        onClick={() => {
          subscribe.mutate(isSubscribed ? null : "subscribed");
        }}
      >
        <Bell size={13} aria-hidden="true" />
        <span>{isSubscribed ? "Subscribed" : "Subscribe"}</span>
      </button>
      <button
        type="button"
        className={`forum-pill-btn ${isMuted ? "is-active" : ""}`}
        aria-pressed={isMuted}
        disabled={!writable || subscribe.isPending}
        onClick={() => {
          subscribe.mutate(isMuted ? null : "muted");
        }}
      >
        <BellOff size={13} aria-hidden="true" />
        <span>Mute</span>
      </button>
      <button
        type="button"
        className="forum-pill-btn"
        disabled={!writable || pin.isPending}
        onClick={() => {
          pin.mutate();
        }}
      >
        <Pin size={13} aria-hidden="true" />
        <span>{post.pinnedAt === null ? "Pin" : "Unpin"}</span>
      </button>
      {writable && (
        <>
          <span className="spacer" />
          <button type="button" onClick={onEdit}>
            <Pencil size={13} aria-hidden="true" />
            Edit post
          </button>
          {post.state === "open" ? (
            <button
              type="button"
              onClick={() => {
                onStateAction("resolve");
              }}
            >
              Resolve
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                onStateAction("reopen");
              }}
            >
              Reopen
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function ThreadPropertiesRail({
  post,
  bootstrap,
  writable,
  onHandoff,
  onLinkIssue,
  onPromote,
}: {
  post: PostDetail;
  bootstrap: BootstrapData;
  writable: boolean;
  onHandoff: () => void;
  onLinkIssue: () => void;
  onPromote: (target: PromoteTarget) => void;
}) {
  const actor = useCurrentActor();
  const refresh = useRefreshForum();
  const viewTransition = useViewTransitions();

  const claim = useMutation({
    mutationFn: () =>
      api.forum.claim.mutate({ actor: currentActor(), id: post.id }),
    onSuccess: async (updated) => {
      await refresh();
      notify(`Claimed ${updated.identifier}`);
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : "Failed to claim");
    },
  });

  const updateProject = useMutation({
    mutationFn: (slug: string | null) =>
      api.forum.update.mutate({
        actor: currentActor(),
        id: post.id,
        expectedRevision: post.revision,
        projectSlug: slug,
      }),
    onSuccess: () => refresh(),
  });

  const unlinkIssue = useMutation({
    mutationFn: (issueIdentifier: string) =>
      api.forum.unlinkIssue.mutate({
        actor: currentActor(),
        id: post.id,
        issueIdentifier,
      }),
    onSuccess: async (_updated, issueIdentifier) => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: issueKey(issueIdentifier) }),
        queryClient.invalidateQueries({ queryKey: eventsKey(issueIdentifier) }),
      ]);
      notify(`Unlinked ${issueIdentifier}`);
    },
  });

  const activeProjects = bootstrap.projects.filter(
    ({ archivedAt }) => archivedAt === null,
  );

  return (
    <aside className="properties forum-rail" aria-label="Thread properties">
      {post.kind === "notice" && (
        <section className="forum-rail-section">
          <h2>Coordination owner</h2>
          {post.owner === null ? (
            <p className="muted">Unclaimed</p>
          ) : (
            <ActorChip actor={post.owner} />
          )}
          {writable && (
            <div className="forum-rail-buttons">
              <button
                type="button"
                disabled={claim.isPending || post.owner?.key === actor.key}
                onClick={() => {
                  claim.mutate();
                }}
              >
                Claim
              </button>
              <button type="button" onClick={onHandoff}>
                Handoff…
              </button>
            </div>
          )}
        </section>
      )}
      <section className="forum-rail-section">
        <h2>Project</h2>
        <div className="forum-project-control">
          {post.project !== null && <Swatch color={post.project.color} />}
          <select
            aria-label="Project"
            disabled={!writable || updateProject.isPending}
            value={post.project?.slug ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              updateProject.mutate(value === "" ? null : value);
            }}
          >
            <option value="">No project</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="forum-rail-section">
        <h2>Scopes</h2>
        <div className="forum-scope-list">
          {post.scopes.length > 0 ? (
            post.scopes.map((scope) => (
              <span key={scope} className="forum-scope-chip">
                {scope}
              </span>
            ))
          ) : (
            <span className="forum-scope-chip is-global">global</span>
          )}
        </div>
      </section>
      <section className="forum-rail-section">
        <h2>Linked issues</h2>
        {post.linkedIssues.length === 0 ? (
          <p className="muted">No linked issues</p>
        ) : (
          <div className="forum-linked-issues-list">
            {post.linkedIssues.map((issue) => (
              <div key={issue.id} className="forum-linked-issue-item">
                <Link
                  to={`/issues/${issue.identifier}`}
                  viewTransition={viewTransition}
                  className="forum-linked-issue-link"
                >
                  <StateIcon
                    type={issue.state.type}
                    color={issue.state.color}
                  />
                  <span className="identifier">{issue.identifier}</span>
                  <span className="forum-linked-issue-title">
                    {issue.title}
                  </span>
                </Link>
                {writable && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove link to ${issue.identifier}`}
                    disabled={unlinkIssue.isPending}
                    onClick={() => {
                      unlinkIssue.mutate(issue.identifier);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {writable && (
          <div className="forum-rail-buttons">
            <button type="button" onClick={onLinkIssue}>
              + Link issue
            </button>
            <button
              type="button"
              onClick={() => {
                onPromote({ sourceBody: post.body });
              }}
            >
              Promote to issue…
            </button>
          </div>
        )}
      </section>
    </aside>
  );
}
