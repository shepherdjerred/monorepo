import { useCallback, useRef } from "react";
import { Link, type NavigateFunction } from "react-router";
import { MessageSquare, ThumbsUp } from "lucide-react";
import { useViewTransitions } from "#client/feedback/motion.ts";
import { RelativeTime } from "#client/ui/time.tsx";
import { Avatar, Swatch } from "#client/ui/ui.tsx";
import type { Post } from "./data.ts";
import {
  ForumKindBadge,
  ForumPinnedBadge,
  ForumStatusBadge,
} from "./forum-badges.tsx";

const editableSelector =
  "input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]";
const popupSelector = '[role="menu"], [role="listbox"], option';
const activatableSelector =
  "a[href], button, summary, select, [role=button], [role=option]";
const arrowStepMap: Record<string, 1 | -1> = {
  ArrowDown: 1,
  ArrowUp: -1,
};

const eventTarget = (event: KeyboardEvent) =>
  event.target instanceof Element ? event.target : null;

function isPlainKeyBlocked(
  event: KeyboardEvent,
  target: Element | null,
): boolean {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    target?.closest(editableSelector) != null ||
    target?.closest(popupSelector) != null ||
    document.querySelector('[role="dialog"]:not(.peek):not([inert])') !== null
  );
}

function stepDelta(key: string, target: Element | null): 1 | -1 | undefined {
  if (key === "j") return 1;
  if (key === "k") return -1;
  return target?.closest("a[data-forum-row]") == null
    ? undefined
    : arrowStepMap[key];
}

function focusForumRow(
  identifiers: readonly string[],
  focused: string | undefined,
  delta: 1 | -1,
  setFocused: (identifier: string) => void,
): boolean {
  const first = identifiers[0];
  if (first === undefined) return false;
  const currentIndex =
    focused === undefined ? -1 : identifiers.indexOf(focused);
  const nextIdent =
    currentIndex === -1
      ? first
      : identifiers[
          Math.max(0, Math.min(identifiers.length - 1, currentIndex + delta))
        ];
  if (nextIdent === undefined) return false;
  setFocused(nextIdent);
  const link = document.querySelector<HTMLElement>(
    `a[data-forum-row="${CSS.escape(nextIdent)}"]`,
  );
  link?.focus({ preventScroll: true });
  link?.scrollIntoView({ block: "nearest" });
  return true;
}

type ForumKeyboardBindings = {
  identifiers: readonly string[];
  focused: string | undefined;
  setFocused: (identifier: string) => void;
  navigate: NavigateFunction;
  writable: boolean;
  openComposer: () => void;
};

function dispatchForumKey(
  event: KeyboardEvent,
  bindings: ForumKeyboardBindings,
): boolean {
  const target = eventTarget(event);
  if (isPlainKeyBlocked(event, target)) return false;
  const delta = stepDelta(event.key, target);
  if (delta !== undefined) {
    return focusForumRow(
      bindings.identifiers,
      bindings.focused,
      delta,
      bindings.setFocused,
    );
  }
  if (event.key === "n" && bindings.writable) {
    bindings.openComposer();
    return true;
  }
  if (event.key !== "Enter" || target?.closest(activatableSelector) != null) {
    return false;
  }
  const chosen =
    bindings.focused !== undefined &&
    bindings.identifiers.includes(bindings.focused)
      ? bindings.focused
      : bindings.identifiers[0];
  if (chosen === undefined) return false;
  void bindings.navigate(`/forum/${chosen}`);
  return true;
}

export function useForumListKeyboard(bindings: ForumKeyboardBindings) {
  const current = useRef(bindings);
  current.current = bindings;
  return useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (dispatchForumKey(event, current.current)) {
        event.preventDefault();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

export function ForumThreadRow({
  post,
  focused,
  onFocusRow,
}: {
  post: Post;
  focused: boolean;
  onFocusRow: (identifier: string) => void;
}) {
  const viewTransition = useViewTransitions();
  return (
    <li className={`forum-row ${focused ? "is-focused" : ""}`}>
      <div className="forum-row-main">
        <div className="forum-row-top">
          {post.unread && (
            <>
              <span className="forum-unread-dot" aria-hidden="true" />
              <span className="sr-only">Unread</span>
            </>
          )}
          <span className="identifier">{post.identifier}</span>
          {post.pinnedAt !== null && <ForumPinnedBadge />}
          <ForumKindBadge kind={post.kind} />
          <ForumStatusBadge post={post} />
          <Link
            to={`/forum/${post.identifier}`}
            viewTransition={viewTransition}
            data-forum-row={post.identifier}
            aria-current={focused ? "true" : undefined}
            className="forum-row-title"
            onFocus={() => {
              onFocusRow(post.identifier);
            }}
          >
            {post.title}
          </Link>
        </div>
        {post.searchSnippet !== undefined &&
          post.searchSnippet.trim() !== "" && (
            <p className="forum-snippet">{post.searchSnippet}</p>
          )}
        <div className="forum-row-meta">
          {post.project !== null && (
            <span className="forum-chip">
              <Swatch color={post.project.color} />
              <span>{post.project.name}</span>
            </span>
          )}
          {post.scopes.length > 0 ? (
            post.scopes.map((scope) => (
              <span key={scope} className="forum-scope-chip">
                {scope}
              </span>
            ))
          ) : (
            <span className="forum-scope-chip is-global">global</span>
          )}
          {post.linkedIssues.map((issue) => (
            <Link
              key={issue.id}
              to={`/issues/${issue.identifier}`}
              className="forum-issue-chip identifier"
            >
              {issue.identifier}
            </Link>
          ))}
          {post.kind === "notice" && post.owner !== null && (
            <span className="forum-owner-chip">
              <Avatar actor={post.owner} decorative />
              <span>Owner: {post.owner.name}</span>
            </span>
          )}
        </div>
      </div>
      <div className="forum-row-stats">
        {post.voteCount > 0 && (
          <span className="forum-stat" title="Upvotes">
            <ThumbsUp size={12} aria-hidden="true" />
            <span>{post.voteCount}</span>
          </span>
        )}
        {post.reactions.map((reaction) => (
          <span key={reaction.emoji} className="forum-reaction-summary">
            {reaction.emoji} {reaction.count}
          </span>
        ))}
        <span className="forum-stat" title="Replies">
          <MessageSquare size={12} aria-hidden="true" />
          <span>{post.replyCount}</span>
        </span>
        <span className="forum-author-cell">
          <Avatar actor={post.creator} decorative />
          <span className="forum-author-name">{post.creator.name}</span>
        </span>
        <RelativeTime
          value={post.lastActivityAt}
          style="narrow"
          className="forum-time"
        />
      </div>
    </li>
  );
}
