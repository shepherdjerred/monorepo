import { IssueAttachments } from "./issue-attachments.tsx";
import { IssueDescription } from "./issue-description.tsx";
import { IssueTimeline } from "./issue-timeline.tsx";
import { IssueProperties } from "./issue-properties.tsx";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Archive, ArrowUpRight, History, Trash2 } from "lucide-react";
import {
  api,
  refresh,
  type BootstrapData,
  type IssueDetailData,
} from "./api.ts";
import { currentActor } from "./identity.ts";
import { ErrorNotice, Modal } from "./ui.tsx";
import { MarkdownEditor } from "./markdown.tsx";
import { ActivityList } from "./activity.tsx";
import { UpdateIssueSchema } from "#shared/schema.ts";

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
  const query = useQuery({
    queryKey: ["issue", identifier],
    queryFn: () =>
      api.issues.byIdentifier.query({
        identifier,
        viewerActorKey: currentActor().key,
      }),
  });
  if (query.error !== null) return <ErrorNotice error={query.error} />;
  if (query.data === undefined)
    return <div className="loading">Loading issue…</div>;
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
  const [title, setTitle] = useState(issue.title);
  const [comment, setComment] = useState("");
  const [commentAttachments, setCommentAttachments] = useState<string[]>([]);
  const [history, setHistory] = useState(false);
  const [relating, setRelating] = useState(false);
  const [relationTarget, setRelationTarget] = useState("");
  const [relationType, setRelationType] = useState<
    "blocks" | "blocked-by" | "duplicate" | "related"
  >("related");
  const [deleting, setDeleting] = useState(false);
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.issues.update.mutate(
        UpdateIssueSchema.parse({
          actor: currentActor(),
          identifier: issue.identifier,
          expectedRevision: issue.revision,
          ...patch,
        }),
      ),
    onSuccess: () => {
      void refresh();
    },
  });
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
      void refresh();
    },
  });
  const relation = useMutation({
    mutationFn: () =>
      api.relations.create.mutate({
        actor: currentActor(),
        identifier: issue.identifier,
        target: relationTarget.toUpperCase(),
        type: relationType,
      }),
    onSuccess: () => {
      setRelating(false);
      setRelationTarget("");
      void refresh();
    },
  });
  const removeRelation = useMutation({
    mutationFn: (id: string) =>
      api.relations.delete.mutate({ actor: currentActor(), id }),
    onSuccess: () => {
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
    onSuccess: () => {
      void refresh();
      close?.();
      if (!peek) location.assign("/issues");
    },
  });
  const events = useQuery({
    queryKey: ["events", issue.identifier],
    queryFn: () =>
      api.issues.activity.query({ identifier: issue.identifier, limit: 100 }),
  });
  const disabled = !bootstrap.writesEnabled || update.isPending;
  const errors = [
    update.error,
    vote.error,
    addComment.error,
    relation.error,
    removeRelation.error,
    removeIssue.error,
    events.error,
  ].filter((error) => error !== null);
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
            update.mutate({ archived: issue.archivedAt === null });
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
              if (title !== issue.title && title.trim() !== "")
                update.mutate({ title });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          <IssueDescription issue={issue} disabled={disabled} />
          <IssueAttachments files={issue.attachments} />
          <section className="relations">
            <div className="section-heading">
              <h2>Relations</h2>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => {
                  setRelating(true);
                }}
              >
                + Add relation
              </button>
            </div>
            {issue.relations.length === 0 && (
              <p className="muted">No related issues</p>
            )}
            {issue.relations.map((r) => {
              const target = r.fromId === issue.id ? r.to : r.from;
              return (
                <div className="relation" key={r.id}>
                  <span className="muted">
                    {r.type === "blocks" && r.toId === issue.id
                      ? "blocked by"
                      : r.type}
                  </span>
                  <Link to={`/issues/${target.identifier}`}>
                    <span className="identifier">{target.identifier}</span>{" "}
                    {target.title}
                  </Link>
                  <button
                    className="icon-button"
                    aria-label={`Remove relation to ${target.identifier}`}
                    disabled={disabled}
                    onClick={() => {
                      removeRelation.mutate(r.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </section>
          <section>
            <div className="section-heading">
              <h2>Activity</h2>
              <span className="muted">{issue.comments.length} comments</span>
            </div>
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
            </form>
          </section>
        </div>
        <IssueProperties
          issue={issue}
          bootstrap={bootstrap}
          disabled={disabled}
          update={(patch) => {
            update.mutate(patch);
          }}
          vote={() => {
            vote.mutate();
          }}
          voting={vote.isPending}
          onDelete={() => {
            setDeleting(true);
          }}
        />
      </div>
      {errors.map((error, index) => (
        <ErrorNotice key={index} error={error} />
      ))}
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
        title="Add relation"
        open={relating}
        onClose={() => {
          setRelating(false);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            relation.mutate();
          }}
        >
          <label>
            Relationship
            <select
              value={relationType}
              onChange={(e) => {
                const value = e.target.value;
                if (
                  value === "blocks" ||
                  value === "blocked-by" ||
                  value === "duplicate" ||
                  value === "related"
                )
                  setRelationType(value);
              }}
            >
              <option value="related">Related to</option>
              <option value="blocks">Blocks</option>
              <option value="blocked-by">Blocked by</option>
              <option value="duplicate">Duplicate of</option>
            </select>
          </label>
          <label>
            Issue identifier
            <input
              value={relationTarget}
              onChange={(e) => {
                setRelationTarget(e.target.value);
              }}
              placeholder="AI-123"
              required
              pattern="[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*"
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={relation.isPending}>
              Add relation
            </button>
          </div>
        </form>
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
