import { useState } from "react";
import { Paperclip, Pin, SmilePlus } from "lucide-react";
import {
  ForumEmojiSchema,
  type ForumEmoji,
  type ForumKind,
} from "#shared/forum.ts";
import { Modal } from "#client/ui/ui.tsx";
import type { ForumAttachment, ForumReaction, Post } from "./data.ts";

export function ForumPinnedBadge() {
  return (
    <span className="forum-badge is-pinned">
      <Pin size={11} aria-hidden="true" />
      Pinned
    </span>
  );
}

export function ForumKindBadge({ kind }: { kind: ForumKind }) {
  return <span className={`forum-badge is-kind-${kind}`}>{kind}</span>;
}

export function ForumStatusBadge({
  post,
}: {
  post: Pick<Post, "kind" | "state" | "expired" | "answered">;
}) {
  if (post.state === "resolved") {
    return <span className="forum-badge is-resolved">resolved</span>;
  }
  if (post.expired) {
    return <span className="forum-badge is-expired">expired</span>;
  }
  return post.kind === "question" && post.answered ? (
    <span className="forum-badge is-answered">✓ Answered</span>
  ) : (
    <span className="forum-badge is-active">active</span>
  );
}

const isPreviewableImage = (file: ForumAttachment) =>
  file.contentType.startsWith("image/") && file.contentType !== "image/svg+xml";

const imageDimensions = (file: ForumAttachment) =>
  file.width === null || file.height === null
    ? {}
    : { width: file.width, height: file.height };

export function ForumAttachments({
  files,
  headingLevel = "h2",
}: {
  files: readonly ForumAttachment[];
  headingLevel?: "h2" | "h3";
}) {
  const [preview, setPreview] = useState<ForumAttachment>();
  if (files.length === 0) {
    return null;
  }
  const Heading = headingLevel;
  return (
    <div className="attachments forum-attachments">
      <Heading className="forum-attachments-heading">
        <Paperclip size={14} aria-hidden="true" />
        Attachments
      </Heading>
      <div className="forum-attachment-items">
        {files.map((file) =>
          isPreviewableImage(file) ? (
            <button
              key={file.id}
              type="button"
              onClick={() => {
                setPreview(file);
              }}
            >
              <img
                src={file.url}
                alt={file.filename}
                loading="lazy"
                {...imageDimensions(file)}
              />
              <span>{file.filename}</span>
            </button>
          ) : (
            <a key={file.id} href={file.url} target="_blank" rel="noreferrer">
              {file.filename}
            </a>
          ),
        )}
      </div>
      <Modal
        title={preview?.filename ?? "Attachment"}
        open={preview !== undefined}
        onClose={() => {
          setPreview(undefined);
        }}
      >
        {preview !== undefined && (
          <>
            <img
              className="attachment-preview"
              src={preview.url}
              alt={preview.filename}
              {...imageDimensions(preview)}
            />
            <a href={preview.url} target="_blank" rel="noreferrer">
              Open original
            </a>
          </>
        )}
      </Modal>
    </div>
  );
}

export function EmojiReactionBar({
  reactions,
  writable,
  disabled = false,
  onToggle,
}: {
  reactions: readonly ForumReaction[];
  writable: boolean;
  disabled?: boolean;
  onToggle: (emoji: ForumEmoji, remove: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const reacted = new Set(
    reactions.filter((item) => item.viewerReacted).map((item) => item.emoji),
  );
  return (
    <div className="forum-reactions-bar">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          className={`forum-reaction-pill ${reaction.viewerReacted ? "is-active" : ""}`}
          aria-pressed={reaction.viewerReacted}
          disabled={!writable || disabled}
          title={reaction.actorKeys.join(", ")}
          onClick={() => {
            onToggle(reaction.emoji, reaction.viewerReacted);
          }}
        >
          <span>{reaction.emoji}</span>
          <span className="count">{reaction.count}</span>
        </button>
      ))}
      {writable && (
        <div className="forum-reaction-picker-wrap">
          <button
            type="button"
            className="forum-pill-btn"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <SmilePlus size={13} aria-hidden="true" />
            <span>+ React</span>
          </button>
          {open && (
            <div
              className="forum-emoji-palette"
              role="group"
              aria-label="Choose reaction"
            >
              {ForumEmojiSchema.options.map((emoji) => {
                const active = reacted.has(emoji);
                return (
                  <button
                    key={emoji}
                    type="button"
                    className={`forum-emoji-choice ${active ? "is-active" : ""}`}
                    aria-pressed={active}
                    disabled={disabled}
                    onClick={() => {
                      onToggle(emoji, active);
                      setOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
