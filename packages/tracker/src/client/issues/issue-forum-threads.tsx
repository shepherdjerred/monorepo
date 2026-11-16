import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Trash2 } from "lucide-react";
import { ForumPostIdOrIdentifierSchema } from "#shared/forum.ts";
import { api, queryClient, type IssueDetailData } from "#client/data/api.ts";
import { eventsKey, issueKey } from "#client/data/cache.ts";
import { currentActor } from "#client/data/identity.ts";
import { useViewTransitions } from "#client/feedback/motion.ts";
import { ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { notify, notifyError } from "#client/ui/toast.tsx";

type LinkedThread = IssueDetailData["forumThreads"][number];

function threadBadgeText(thread: LinkedThread): string {
  if (thread.state === "resolved") return "resolved";
  if (thread.expired) return "expired";
  return thread.kind === "question" && thread.answered
    ? "✓ Answered"
    : "active";
}

function refreshIssueAndForum(issueIdentifier: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: issueKey(issueIdentifier) }),
    queryClient.invalidateQueries({ queryKey: eventsKey(issueIdentifier) }),
    queryClient.invalidateQueries({ queryKey: ["forum"] }),
  ]);
}

function LinkThreadModal({
  open,
  onClose,
  issueIdentifier,
  linkedIds,
}: {
  open: boolean;
  onClose: () => void;
  issueIdentifier: string;
  linkedIds: ReadonlySet<string>;
}) {
  const [target, setTarget] = useState("");
  const trimmed = target.trim();
  const validRef = ForumPostIdOrIdentifierSchema.safeParse(trimmed).success;
  const search = useQuery({
    queryKey: ["forum", "link-search", trimmed],
    queryFn: () => api.forum.search.query({ query: trimmed, limit: 8 }),
    enabled: open && trimmed.length > 0,
  });
  const link = useMutation({
    mutationFn: (reference: string) =>
      api.forum.linkIssue.mutate({
        actor: currentActor(),
        id: reference,
        issueIdentifier,
      }),
    onSuccess: async (post) => {
      await refreshIssueAndForum(issueIdentifier);
      notify(`Linked ${post.identifier}`);
      setTarget("");
      onClose();
    },
  });
  const matches = (search.data?.items ?? []).filter(
    (item) => !linkedIds.has(item.id),
  );
  return (
    <Modal title="Link forum thread" open={open} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (validRef) {
            link.mutate(trimmed);
          }
        }}
      >
        <label htmlFor="link-forum-thread-input">
          Forum thread
          <input
            id="link-forum-thread-input"
            value={target}
            placeholder="FM-12 or search threads…"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              setTarget(event.target.value);
              if (link.error !== null) {
                link.reset();
              }
            }}
          />
        </label>
        {matches.length > 0 && (
          <div className="forum-search-picks" role="list">
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                className="forum-search-pick"
                disabled={link.isPending}
                onClick={() => {
                  link.mutate(item.identifier);
                }}
              >
                <span className="identifier">{item.identifier}</span>
                <span className="forum-badge">{item.kind}</span>
                <span className="forum-search-pick-title">{item.title}</span>
              </button>
            ))}
          </div>
        )}
        {search.error !== null && <ErrorNotice error={search.error} />}
        {link.error !== null && <ErrorNotice error={link.error} />}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={link.isPending || !validRef}
          >
            {link.isPending ? "Linking…" : "Link thread"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function IssueForumThreads({
  issue,
  disabled,
}: {
  issue: IssueDetailData;
  disabled: boolean;
}) {
  const [linking, setLinking] = useState(false);
  const viewTransition = useViewTransitions();
  const unlink = useMutation({
    mutationFn: (threadIdentifier: string) =>
      api.forum.unlinkIssue.mutate({
        actor: currentActor(),
        id: threadIdentifier,
        issueIdentifier: issue.identifier,
      }),
    onSuccess: async (post) => {
      await refreshIssueAndForum(issue.identifier);
      notify(`Unlinked ${post.identifier}`);
    },
    onError: (error) => {
      notifyError(
        error instanceof Error ? error.message : "Failed to unlink thread",
      );
    },
  });
  const linkedIds = new Set(issue.forumThreads.map((thread) => thread.id));
  return (
    <section className="forum-backlinks">
      <div className="section-heading">
        <h2>Forum threads</h2>
        <div className="forum-backlink-actions">
          {!disabled && (
            <Link
              className="text-button"
              to={`/forum?compose=1&issue=${encodeURIComponent(issue.identifier)}`}
            >
              Start thread
            </Link>
          )}
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => {
              setLinking(true);
            }}
          >
            + Link thread
          </button>
        </div>
      </div>
      {issue.forumThreads.length === 0 && (
        <p className="muted">No linked forum threads</p>
      )}
      {issue.forumThreads.map((thread) => (
        <div className="relation forum-backlink-row" key={thread.id}>
          <span className="forum-badge">{thread.kind}</span>
          <span
            className={`forum-badge ${thread.answered ? "is-answered" : ""}`}
          >
            {threadBadgeText(thread)}
          </span>
          <Link
            to={`/forum/${thread.identifier}`}
            viewTransition={viewTransition}
          >
            <span className="identifier">{thread.identifier}</span>{" "}
            {thread.title}
          </Link>
          <span className="count">
            {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove link to ${thread.identifier}`}
            disabled={disabled || unlink.isPending}
            onClick={() => {
              unlink.mutate(thread.identifier);
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <LinkThreadModal
        open={linking}
        onClose={() => {
          setLinking(false);
        }}
        issueIdentifier={issue.identifier}
        linkedIds={linkedIds}
      />
    </section>
  );
}
