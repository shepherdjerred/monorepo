import { IssueAttachments } from "./issue-attachments.tsx";
import { IssueDescription } from "./issue-description.tsx";
import { IssueTimeline } from "./issue-timeline.tsx";
import { IssueProperties } from "./issue-properties.tsx";
import { IssueRelations } from "./issue-relations.tsx";
import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Archive, ArrowUpRight, History } from "lucide-react";
import {
  api,
  queryClient,
  type BootstrapData,
  type IssueDetailData,
} from "#client/data/api.ts";
import { eventsKey, issueKey } from "#client/data/cache.ts";
import { addComment } from "#client/data/detail-mutations.ts";
import { currentActor } from "#client/data/identity.ts";
import { commentWasSaved } from "#client/data/pending-drafts.ts";
import { useDraft } from "#client/data/use-draft.ts";
import { deleteIssue, editIssue } from "#client/data/mutations.ts";
import { ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { MarkdownEditor } from "#client/ui/markdown.tsx";
import { ActivityList } from "./activity.tsx";
import { useIssue } from "./issue-query.ts";
import { RemoteEditNotice } from "#client/live/presence.tsx";
import { isComposing } from "#client/ui/ime.ts";
import { recentIssues } from "#client/shell/recent-issues.ts";
import { SubIssues } from "#client/hierarchy/sub-issues.tsx";

export function IssueDetail({
  identifier,
  bootstrap,
  peek = false,
  close,
}: {
  identifier: string;
  bootstrap: BootstrapData;
  peek?: boolean;
  close?: () => void;
}) {
  const query = useIssue(identifier);
  if (query.error !== null) {
    return <ErrorNotice error={query.error} />;
  }
  if (query.data === undefined) {
    return <div className="loading">Loading issue…</div>;
  }
  return (
    <IssueContent
      key={identifier}
      issue={query.data}
      bootstrap={bootstrap}
      peek={peek}
      {...(close === undefined ? {} : { close })}
    />
  );
}

function IssueContent({
  issue,
  bootstrap,
  peek,
  close,
}: {
  issue: IssueDetailData;
  bootstrap: BootstrapData;
  peek: boolean;
  close?: () => void;
}) {
  const navigate = useNavigate();
  const { identifier } = issue;
  const [title, setTitle] = useState(issue.title);
  const [savedTitle, setSavedTitle] = useState(issue.title);
  const [typingTitle, setTypingTitle] = useState(false);
  // An undo, a conflict or another session can change the title underneath.
  // Text being typed stays; the new title lands under it.
  if (issue.title !== savedTitle) {
    setSavedTitle(issue.title);
    if (!typingTitle || title === savedTitle) {
      setTitle(issue.title);
    }
  }
  const events = useQuery({
    queryKey: eventsKey(identifier),
    queryFn: () =>
      api.issues.activity.query({ identifier: issue.identifier, limit: 100 }),
  });
  const history = events.data;
  const comment = useDraft(`comment:${identifier}`, "", {
    kind: "comment",
    subject: identifier,
    saved:
      history === undefined
        ? undefined
        : (pending) =>
            commentWasSaved(pending, {
              actorKey: currentActor().key,
              comments: issue.comments,
              events: history,
            }),
    recheck: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKey(identifier) }),
        queryClient.invalidateQueries({ queryKey: eventsKey(identifier) }),
      ]),
    notice: "Restored your unsent comment",
  });
  const [showHistory, setHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The comment joins the timeline at once; a refusal hands the text back.
  const postComment = () =>
    comment.send(({ text, attachments }) =>
      addComment(identifier, text, attachments),
    );
  function confirmDelete() {
    setDeleting(false);
    deleteIssue(identifier);
    if (peek) {
      close?.();
    } else {
      void navigate("/issues", { replace: true });
    }
  }
  const disabled = !bootstrap.writesEnabled;
  const TitleHeading = peek ? "h2" : "h1";
  // Opening an issue puts it first among the palette's recent issues.
  // Remembered once per opening, not on every title edit.
  const openedTitle = useRef(issue.title);
  const remember = useCallback(
    (element: HTMLElement | null) => {
      if (element !== null) {
        recentIssues.remember({ identifier, title: openedTitle.current });
      }
    },
    [identifier],
  );
  return (
    <article className={`issue-detail ${peek ? "is-peek" : ""}`} ref={remember}>
      <header className="detail-toolbar">
        <nav className="detail-breadcrumb" aria-label="Breadcrumb">
          <span>{issue.team.name}</span>
          <span className="muted" aria-hidden="true">
            /
          </span>
          {issue.parent !== null && (
            <>
              <Link
                className="identifier parent-crumb"
                to={`/issues/${issue.parent.identifier}`}
                title={issue.parent.title}
              >
                {issue.parent.identifier}
              </Link>
              <span className="muted" aria-hidden="true">
                /
              </span>
            </>
          )}
          <span className="identifier" aria-current="page">
            {issue.identifier}
          </span>
        </nav>
        <RemoteEditNotice identifier={identifier} actors={bootstrap.actors} />
        <span className="spacer" />
        {peek && (
          <Link
            className="icon-button"
            aria-label="Open full issue"
            to={`/issues/${issue.identifier}`}
          >
            <ArrowUpRight size={16} />
          </Link>
        )}
        <button
          className="icon-button"
          aria-label="Edit history"
          onClick={() => {
            setHistory(true);
          }}
        >
          <History size={17} />
        </button>
        <button
          className="icon-button"
          aria-label={
            issue.archivedAt === null ? "Archive issue" : "Unarchive issue"
          }
          disabled={disabled}
          onClick={() => {
            void editIssue(identifier, {
              kind: "archive",
              archived: issue.archivedAt === null,
            });
          }}
        >
          <Archive size={17} />
        </button>
      </header>
      {issue.archivedAt !== null && (
        <div className="banner">This issue is archived.</div>
      )}
      <div className="detail-grid">
        <div className="detail-main">
          <TitleHeading className="detail-title-heading">
            <textarea
              className="detail-title"
              rows={1}
              aria-label="Issue title"
              value={title}
              disabled={disabled}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              onFocus={() => {
                setTypingTitle(true);
              }}
              onBlur={() => {
                setTypingTitle(false);
                if (title.trim() === "") {
                  setTitle(issue.title);
                } else if (title !== issue.title) {
                  void editIssue(identifier, { kind: "title", title });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  // That Enter may be confirming an IME conversion instead.
                  if (!isComposing(e.nativeEvent)) e.currentTarget.blur();
                }
                // Escape takes back an unsaved title before it closes anything.
                if (e.key === "Escape" && title !== issue.title) {
                  e.preventDefault();
                  e.stopPropagation();
                  setTitle(issue.title);
                }
              }}
            />
          </TitleHeading>
          <IssueDescription issue={issue} disabled={disabled} />
          <IssueAttachments files={issue.attachments} />
          <SubIssues issue={issue} bootstrap={bootstrap} disabled={disabled} />
          <IssueRelations issue={issue} disabled={disabled} />
          <section>
            <div className="section-heading">
              <h2>Activity</h2>
              <span className="muted">{issue.comments.length} comments</span>
            </div>
            {events.error !== null && <ErrorNotice error={events.error} />}
            <IssueTimeline
              issue={issue}
              events={events.data ?? []}
              disabled={disabled}
            />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void postComment();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.requestSubmit();
                }
              }}
            >
              <MarkdownEditor
                value={comment.text}
                onChange={comment.setText}
                onAttachments={comment.addAttachments}
                placeholder="Leave a comment…"
                label="Comment"
                required
              />
              <div className="actions">
                <button
                  className="primary"
                  disabled={disabled || comment.text.trim() === ""}
                >
                  Comment
                </button>
              </div>
            </form>
          </section>
        </div>
        <IssueProperties
          issue={issue}
          bootstrap={bootstrap}
          disabled={disabled}
          onDelete={() => {
            setDeleting(true);
          }}
        />
      </div>
      <Modal
        title={`History · ${issue.identifier}`}
        open={showHistory}
        onClose={() => {
          setHistory(false);
        }}
      >
        {events.data !== undefined && (
          <ActivityList events={events.data} detailed />
        )}
      </Modal>
      <Modal
        title="Delete this issue?"
        open={deleting}
        onClose={() => {
          setDeleting(false);
        }}
      >
        <p>
          The issue and comments will be removed. Their audit history and
          attachments remain available.
        </p>
        <div className="actions">
          <button
            onClick={() => {
              setDeleting(false);
            }}
          >
            Cancel
          </button>
          <button className="danger" onClick={confirmDelete}>
            Delete {issue.identifier}
          </button>
        </div>
      </Modal>
    </article>
  );
}
