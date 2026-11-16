import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { AlertTriangle, Clock } from "lucide-react";
import { api } from "#client/data/api.ts";
import { currentActor, useCurrentActor } from "#client/data/identity.ts";
import { useViewTransitions } from "#client/feedback/motion.ts";
import { RelativeTime } from "#client/ui/time.tsx";
import { Avatar } from "#client/ui/ui.tsx";
import { notify, notifyError } from "#client/ui/toast.tsx";
import { useRefreshForum, type Post } from "./data.ts";
import { ForumPinnedBadge } from "./forum-badges.tsx";

export function ActiveNoticesStrip({
  notices,
  writable,
  focused,
  onFocusRow,
}: {
  notices: readonly Post[];
  writable: boolean;
  focused: string | undefined;
  onFocusRow: (identifier: string) => void;
}) {
  const actor = useCurrentActor();
  const refresh = useRefreshForum();
  const viewTransition = useViewTransitions();
  const claim = useMutation({
    mutationFn: (id: string) =>
      api.forum.claim.mutate({ actor: currentActor(), id }),
    onSuccess: async (updated) => {
      await refresh();
      notify(`Claimed ${updated.identifier}`);
    },
    onError: (error) => {
      notifyError(
        error instanceof Error ? error.message : "Failed to claim notice",
      );
    },
  });

  if (notices.length === 0) {
    return null;
  }

  return (
    <section
      className="forum-notices-strip"
      aria-labelledby="active-notices-heading"
    >
      <div className="forum-section-header">
        <h2 id="active-notices-heading">
          <AlertTriangle size={14} aria-hidden="true" />
          Active notices
        </h2>
        <span className="count">{notices.length} open</span>
      </div>
      <ul className="forum-notice-cards" role="list">
        {notices.map((notice) => {
          const isMine = notice.owner?.key === actor.key;
          return (
            <li key={notice.id} className="forum-notice-card">
              <div className="forum-notice-card-top">
                {notice.unread && (
                  <>
                    <span className="forum-unread-dot" aria-hidden="true" />
                    <span className="sr-only">Unread</span>
                  </>
                )}
                <span className="identifier">{notice.identifier}</span>
                {notice.pinnedAt !== null && <ForumPinnedBadge />}
                <Link
                  to={`/forum/${notice.identifier}`}
                  viewTransition={viewTransition}
                  data-forum-row={notice.identifier}
                  aria-current={
                    focused === notice.identifier ? "true" : undefined
                  }
                  className="forum-notice-title"
                  onFocus={() => {
                    onFocusRow(notice.identifier);
                  }}
                >
                  {notice.title}
                </Link>
              </div>
              <div className="forum-notice-card-meta">
                <span className="forum-scope-list">
                  {notice.scopes.length > 0 ? (
                    notice.scopes.map((scope) => (
                      <span key={scope} className="forum-scope-chip">
                        {scope}
                      </span>
                    ))
                  ) : (
                    <span className="forum-scope-chip is-global">global</span>
                  )}
                </span>
                <span className="forum-owner-status">
                  {notice.owner === null ? (
                    <span className="muted">Unclaimed</span>
                  ) : (
                    <span className="forum-owner-chip">
                      <Avatar actor={notice.owner} decorative />
                      <span>Owner: {notice.owner.name}</span>
                    </span>
                  )}
                  {writable && !isMine && (
                    <button
                      type="button"
                      className="forum-claim-inline"
                      disabled={claim.isPending}
                      aria-label={`Claim ${notice.identifier}`}
                      onClick={() => {
                        claim.mutate(notice.identifier);
                      }}
                    >
                      Claim
                    </button>
                  )}
                </span>
                {notice.expiresAt !== null && (
                  <span className="forum-expiry-badge">
                    <Clock size={12} aria-hidden="true" />
                    <span>
                      Expires <RelativeTime value={notice.expiresAt} />
                    </span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
