import type { Task, TaskComment } from "@shepherdjerred/facet-protocol";
import { useId, useState } from "react";
import type { WorkspaceData } from "#sync/sync.ts";
import type { CommandHandler } from "./workspace-commands.ts";
import { sortTasks } from "./workspace.ts";

const maxAttachmentBytes = 16 * 1024 * 1024;
const commentDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function attachmentName(file: File): string {
  if (file.size > maxAttachmentBytes)
    throw new Error("Choose a file smaller than 16 MiB.");
  if (
    file.name === "" ||
    file.name === "." ||
    file.name === ".." ||
    /[/\\\p{Cc}]/u.test(file.name) ||
    new TextEncoder().encode(file.name).length > 255
  ) {
    throw new Error(
      "Give this file a name without slashes or control characters.",
    );
  }
  return file.name;
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const encoded = reader.result;
      if (typeof encoded === "string" && encoded.includes(",")) {
        resolve(encoded.slice(encoded.indexOf(",") + 1));
      } else {
        reject(new Error("Couldn’t read the attachment."));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Couldn’t read the attachment."));
    });
    reader.readAsDataURL(file);
  });
}

type DiscussionProps = {
  task: Task;
  data: WorkspaceData;
  canWrite: boolean;
  onCommand?: CommandHandler;
  onOpenTask?: (task: Task) => void;
  onDownloadAttachment?: (
    taskId: string,
    commentId: string,
    filename: string,
  ) => Promise<void>;
};

function Subtasks({
  task,
  data,
  canWrite,
  onCommand,
  onOpenTask,
}: DiscussionProps) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const inputId = useId();
  const children = data.tasks
    .filter((item) => item.parent_id === task.id && !item.is_deleted)
    .sort(sortTasks);

  async function add() {
    if (onCommand === undefined || adding || title.trim() === "") return;
    setAdding(true);
    try {
      if (
        await onCommand(
          {
            type: "TaskAdd",
            args: {
              title: title.trim(),
              project_id: task.project_id,
              parent_id: task.id,
              ...(task.section_id === undefined
                ? {}
                : { section_id: task.section_id }),
            },
          },
          { tempId: `tmp-${crypto.randomUUID()}`, notice: "Added subtask" },
        )
      )
        setTitle("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section aria-label="Subtasks">
      <h2>
        Subtasks{" "}
        {children.length === 0 ? (
          ""
        ) : (
          <small>
            {children.filter((item) => item.completed).length}/{children.length}
          </small>
        )}
      </h2>
      {children.length === 0 ? (
        <p className="feature-note">No subtasks yet.</p>
      ) : (
        <ul className="feature-item-list">
          {children.map((child) => (
            <li key={child.id}>
              {canWrite && onCommand !== undefined ? (
                <input
                  type="checkbox"
                  aria-label={`Complete ${child.title}`}
                  checked={child.completed}
                  onChange={() =>
                    void onCommand(
                      child.completed
                        ? { type: "TaskUncomplete", args: { id: child.id } }
                        : {
                            type: "TaskComplete",
                            args: {
                              id: child.id,
                              completed_at: new Date().toISOString(),
                            },
                          },
                      {
                        notice: child.completed
                          ? "Reopened subtask"
                          : "Completed subtask",
                      },
                    )
                  }
                />
              ) : null}
              {onOpenTask === undefined ? (
                <span
                  className={child.completed ? "feature-completed" : undefined}
                >
                  {child.title}
                </span>
              ) : (
                <button
                  className={
                    child.completed
                      ? "text-button feature-completed"
                      : "text-button"
                  }
                  type="button"
                  onClick={() => {
                    onOpenTask(child);
                  }}
                >
                  {child.title}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!canWrite || onCommand === undefined ? null : (
        <form
          className="feature-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label htmlFor={inputId}>New subtask</label>
          <div className="feature-inline">
            <input
              id={inputId}
              placeholder="Add a step…"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
            <button
              type="submit"
              className="secondary"
              disabled={adding || title.trim() === ""}
            >
              Add subtask
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function CommentAttachment({
  filename,
  onDownload,
  onRemove,
  downloading,
  disabled,
}: {
  filename: string;
  onDownload?: () => void;
  onRemove?: () => void;
  downloading: boolean;
  disabled: boolean;
}) {
  return (
    <div className="feature-chips">
      {onDownload === undefined ? (
        <span>{filename}</span>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={onDownload}
        >
          {downloading ? "Downloading…" : `Download ${filename}`}
        </button>
      )}
      {onRemove === undefined ? null : (
        <button className="text-button" type="button" onClick={onRemove}>
          Remove file
        </button>
      )}
    </div>
  );
}

function Comments({
  task,
  canWrite,
  onCommand,
  onDownloadAttachment,
}: DiscussionProps) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File>();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState<string>();
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<{
    id: string;
    type: "comment" | "file";
  }>();
  const bodyId = useId();
  const fileId = useId();
  const comments = [...(task.comments ?? [])].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );

  async function post() {
    if (
      sending ||
      onCommand === undefined ||
      (file === undefined && body.trim() === "")
    )
      return;
    setSending(true);
    setMessage("");
    try {
      const comment: TaskComment = {
        id: crypto.randomUUID(),
        body: body.trim(),
        created_at: new Date().toISOString(),
      };
      if (file !== undefined) comment.file_name = attachmentName(file);
      const upload =
        file === undefined
          ? { comment }
          : { comment, attachment_base64: await fileBase64(file) };
      if (
        await onCommand(
          { type: "TaskUpdate", args: { id: task.id, append_comment: upload } },
          { notice: "Added comment" },
        )
      ) {
        setBody("");
        setFile(undefined);
        setFileInputKey((key) => key + 1);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Couldn’t add this comment.",
      );
    } finally {
      setSending(false);
    }
  }

  async function download(commentId: string, filename: string) {
    if (onDownloadAttachment === undefined) return;
    setMessage("");
    setDownloading(commentId);
    try {
      await onDownloadAttachment(task.id, commentId, filename);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Couldn’t download this file.",
      );
    } finally {
      setDownloading(undefined);
    }
  }

  async function remove() {
    if (onCommand === undefined || confirm === undefined) return;
    const args =
      confirm.type === "comment"
        ? { id: task.id, remove_comment_id: confirm.id }
        : { id: task.id, remove_attachment_id: confirm.id };
    if (
      await onCommand(
        { type: "TaskUpdate", args },
        {
          notice:
            confirm.type === "comment"
              ? "Deleted comment"
              : "Removed attachment",
        },
      )
    )
      setConfirm(undefined);
  }

  return (
    <section aria-label="Comments and attachments">
      <h2>Comments</h2>
      {comments.length === 0 ? (
        <p className="feature-note">No comments yet.</p>
      ) : (
        <ul className="feature-item-list">
          {comments.map((comment) => (
            <li key={comment.id} className="feature-comment">
              <time className="feature-note" dateTime={comment.created_at}>
                {commentDate.format(new Date(comment.created_at))}
              </time>
              {comment.body.length === 0 ? null : <p>{comment.body}</p>}
              {comment.file_name === undefined ? null : (
                <CommentAttachment
                  filename={comment.file_name}
                  disabled={downloading !== undefined}
                  downloading={downloading === comment.id}
                  {...(onDownloadAttachment === undefined
                    ? {}
                    : {
                        onDownload: () => {
                          void download(
                            comment.id,
                            comment.file_name ?? "attachment",
                          );
                        },
                      })}
                  {...(canWrite && onCommand !== undefined
                    ? {
                        onRemove: () => {
                          setConfirm({ id: comment.id, type: "file" });
                        },
                      }
                    : {})}
                />
              )}
              {canWrite && onCommand !== undefined ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setConfirm({ id: comment.id, type: "comment" });
                  }}
                >
                  Delete comment
                </button>
              ) : null}
              {confirm?.id === comment.id ? (
                <div className="feature-chips">
                  <span>
                    {confirm.type === "comment"
                      ? "Delete this comment and its attachment?"
                      : "Remove this attachment?"}
                  </span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void remove()}
                  >
                    Confirm {confirm.type === "comment" ? "delete" : "remove"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setConfirm(undefined);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {message === "" ? null : (
        <p role="alert" className="alert">
          {message}
        </p>
      )}
      {!canWrite || onCommand === undefined ? null : (
        <form
          className="feature-form"
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
        >
          <label htmlFor={bodyId}>Comment</label>
          <textarea
            id={bodyId}
            rows={3}
            maxLength={10_000}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
            placeholder="Add a comment…"
          />
          <label htmlFor={fileId}>Attach a file</label>
          <input
            key={fileInputKey}
            id={fileId}
            type="file"
            onChange={(event) => {
              setFile(event.target.files?.[0]);
            }}
          />
          <div className="feature-actions">
            <button
              type="submit"
              className="primary"
              disabled={sending || (body.trim() === "" && file === undefined)}
            >
              {sending ? "Adding…" : "Add comment"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export function TaskDiscussion(props: DiscussionProps) {
  return (
    <div className="feature-detail-grid">
      <Subtasks {...props} />
      <Comments {...props} />
    </div>
  );
}
