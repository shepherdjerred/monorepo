import { IssueAttachments } from "./issue-attachments.tsx";
import { IssueDescription } from "./issue-description.tsx";
import { IssueTimeline } from "./issue-timeline.tsx";
import { IssueProperties } from "./issue-properties.tsx";
import { IssueRelations } from "./issue-relations.tsx";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Archive, ArrowUpRight, History } from "lucide-react";
import {
  api,
  refresh,
  type BootstrapData,
  type IssueDetailData,
} from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { ErrorNotice, Modal } from "#client/ui/ui.tsx";
import { MarkdownEditor } from "#client/ui/markdown.tsx";
import { ActivityList } from "./activity.tsx";
import { UpdateIssueSchema } from "#shared/schema.ts";
import { useIssue } from "./issue-query.ts";
import { announce } from "#client/shell/announce.tsx";

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

/** Which control asked for an update, so its error appears beside it. */
type UpdateSource = "title" | "archive" | "property";

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
  const [title, setTitle] = useState(issue.title);
  const [comment, setComment] = useState("");
  const [commentAttachments, setCommentAttachments] = useState<string[]>([]);
  const [history, setHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = useMutation({
    mutationFn: (change: {
      patch: Record<string, unknown>;
      source: UpdateSource;
    }) =>
      api.issues.update.mutate(
        UpdateIssueSchema.parse({
          actor: currentActor(),
          identifier: issue.identifier,
          expectedRevision: issue.revision,
          ...change.patch,
        }),
      ),
    onSuccess: () => {
      announce("Issue updated");
      void refresh();
    },
  });
  const updateError = (source: UpdateSource) =>
    update.error !== null && update.variables.source === source ? (
      <ErrorNotice error={update.error} />
    ) : null;
  const vote = useMutation({
    mutationFn: () =>
      issue.viewerVoted
        ? api.votes.remove.mutate({
            actor: currentActor(),
            identifier: issue.identifier,
          })
        : api.votes.cast.mutate({
            actor: currentActor(),
            identifier: issue.identifier,
          }),
    onSuccess: () => {
      announce(issue.viewerVoted ? "Vote removed" : "Vote added");
      void refresh();
    },
  });
  const addComment = useMutation({
    mutationFn: () =>
      api.comments.create.mutate({
        actor: currentActor(),
        identifier: issue.identifier,
        body: comment,
        attachmentIds: commentAttachments,
      }),
    onSuccess: () => {
      setComment("");
      setCommentAttachments([]);
      announce("Comment added");
      void refresh();
    },
  });
  const removeIssue = useMutation({
    mutationFn: () =>
      api.issues.delete.mutate({
        actor: currentActor(),
        identifier: issue.identifier,
        expectedRevision: issue.revision,
      }),
    onSuccess: async () => {
      announce(`${issue.identifier} deleted`);
      if (peek) {
        close?.();
      } else {
        await navigate("/issues", { replace: true });
      }
      await refresh();
    },
  });
  const events = useQuery({
    queryKey: ["events", issue.identifier],
    queryFn: () =>
      api.issues.activity.query({ identifier: issue.identifier, limit: 100 }),
  });
  const disabled = !bootstrap.writesEnabled || update.isPending;
  const TitleHeading = peek ? "h2" : "h1";
  return (
    <article className={`issue-detail ${peek ? "is-peek" : ""}`}>
      <header className="detail-toolbar">
        <span>{issue.team.name}</span>
        <span className="muted">/</span>
        <span className="identifier">{issue.identifier}</span>
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
            update.mutate({
              patch: { archived: issue.archivedAt === null },
              source: "archive",
            });
          }}
        >
          <Archive size={17} />
        </button>
      </header>
      {updateError("archive")}
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
              onBlur={() => {
                if (title !== issue.title && title.trim() !== "") {
                  update.mutate({ patch: { title }, source: "title" });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </TitleHeading>
          {updateError("title")}
          <IssueDescription issue={issue} disabled={disabled} />
          <IssueAttachments files={issue.attachments} />
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
                addComment.mutate();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.requestSubmit();
                }
              }}
            >
              <MarkdownEditor
                value={comment}
                onChange={setComment}
                onAttachments={(ids) => {
                  setCommentAttachments((previous) => [...previous, ...ids]);
                }}
                placeholder="Leave a comment…"
                label="Comment"
                required
              />
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    disabled || addComment.isPending || comment.trim() === ""
                  }
                >
                  Comment
                </button>
              </div>
              {addComment.error !== null && (
                <ErrorNotice error={addComment.error} />
              )}
            </form>
          </section>
        </div>
        <IssueProperties
          issue={issue}
          bootstrap={bootstrap}
          disabled={disabled}
          update={(patch) => {
            update.mutate({ patch, source: "property" });
          }}
          error={update.variables?.source === "property" ? update.error : null}
          voteError={vote.error}
          vote={() => {
            vote.mutate();
          }}
          voting={vote.isPending}
          onDelete={() => {
            setDeleting(true);
          }}
        />
      </div>
      <Modal
        title={`History · ${issue.identifier}`}
        open={history}
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
        {removeIssue.error !== null && (
          <ErrorNotice error={removeIssue.error} />
        )}
        <div className="actions">
          <button
            onClick={() => {
              setDeleting(false);
            }}
          >
            Cancel
          </button>
          <button
            className="danger"
            disabled={removeIssue.isPending}
            onClick={() => {
              removeIssue.mutate();
            }}
          >
            Delete {issue.identifier}
          </button>
        </div>
      </Modal>
    </article>
  );
}
