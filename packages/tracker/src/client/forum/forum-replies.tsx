import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, CornerDownRight, ThumbsUp } from "lucide-react";
import type { ForumEmoji } from "#shared/forum.ts";
import { api } from "#client/data/api.ts";
import { currentActor } from "#client/data/identity.ts";
import { useDraft } from "#client/data/use-draft.ts";
import { Markdown, MarkdownEditor } from "#client/ui/markdown.tsx";
import { RelativeTime } from "#client/ui/time.tsx";
import { Avatar, ErrorNotice } from "#client/ui/ui.tsx";
import {
  groupForumReplies,
  useRefreshForum,
  type ForumReply,
  type PostDetail,
} from "./data.ts";
import { EmojiReactionBar, ForumAttachments } from "./forum-badges.tsx";
import type { PromoteTarget } from "./forum-modals.tsx";

function InlineReplyEditor({
  reply,
  onDone,
}: {
  reply: ForumReply;
  onDone: () => void;
}) {
  const [body, setBody] = useState(reply.body);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const refresh = useRefreshForum();
  const update = useMutation({
    mutationFn: () =>
      api.forum.updateReply.mutate({
        actor: currentActor(),
        replyId: reply.id,
        body,
        attachmentIds,
      }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  return (
    <form
      className="forum-inline-editor"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate();
      }}
    >
      <MarkdownEditor
        label="Edit reply"
        required
        placeholder="Update reply…"
        value={body}
        onChange={setBody}
        onAttachments={(ids) => {
          setAttachmentIds((prev) => [...prev, ...ids]);
        }}
      />
      {update.error !== null && <ErrorNotice error={update.error} />}
      <div className="forum-actions">
        <button
          type="submit"
          className="primary"
          disabled={update.isPending || body.trim() === ""}
        >
          {update.isPending ? "Saving…" : "Save reply"}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function NestedReplyForm({
  postId,
  parentReplyId,
  onClose,
}: {
  postId: string;
  parentReplyId: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const refresh = useRefreshForum();
  const send = useMutation({
    mutationFn: () =>
      api.forum.reply.mutate({
        actor: currentActor(),
        id: postId,
        parentReplyId,
        body,
        attachmentIds,
      }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <form
      className="forum-nested-composer"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <label htmlFor={`nested-reply-${parentReplyId}`}>Nested reply</label>
      <MarkdownEditor
        id={`nested-reply-${parentReplyId}`}
        label="Nested reply"
        required
        placeholder="Reply to this thread…"
        value={body}
        onChange={setBody}
        onAttachments={(ids) => {
          setAttachmentIds((prev) => [...prev, ...ids]);
        }}
      />
      {send.error !== null && <ErrorNotice error={send.error} />}
      <div className="forum-actions">
        <button
          type="submit"
          className="primary"
          disabled={send.isPending || body.trim() === ""}
        >
          {send.isPending ? "Posting…" : "Post sub-reply"}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReplyItem({
  post,
  reply,
  writable,
  isEditing,
  onStartEdit,
  onStopEdit,
  onReplyTo,
  onPromote,
}: {
  post: PostDetail;
  reply: ForumReply;
  writable: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onReplyTo: () => void;
  onPromote: (target: PromoteTarget) => void;
}) {
  const refresh = useRefreshForum();
  const vote = useMutation({
    mutationFn: () =>
      api.forum.vote.mutate({
        actor: currentActor(),
        replyId: reply.id,
        remove: reply.viewerVoted,
      }),
    onSuccess: () => refresh(),
  });
  const react = useMutation({
    mutationFn: ({ emoji, remove }: { emoji: ForumEmoji; remove: boolean }) =>
      api.forum.react.mutate({
        actor: currentActor(),
        replyId: reply.id,
        emoji,
        remove,
      }),
    onSuccess: () => refresh(),
  });
  const accept = useMutation({
    mutationFn: () =>
      api.forum.acceptReply.mutate({
        actor: currentActor(),
        id: post.id,
        replyId: reply.accepted ? null : reply.id,
      }),
    onSuccess: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: () =>
      api.forum.deleteReply.mutate({
        actor: currentActor(),
        replyId: reply.id,
      }),
    onSuccess: () => refresh(),
  });

  if (reply.deleted) {
    return (
      <div id={`reply-${reply.id}`} className="forum-reply-card is-deleted">
        <p className="muted">[Reply deleted]</p>
      </div>
    );
  }

  return (
    <div
      id={`reply-${reply.id}`}
      className={`forum-reply-card ${reply.accepted ? "is-accepted" : ""}`}
    >
      <div className="forum-reply-header">
        <Avatar actor={reply.author} decorative />
        <strong>{reply.author.name}</strong>
        <code className="identifier">{reply.author.key}</code>
        <RelativeTime value={reply.createdAt} className="muted" />
        {reply.editedAt !== null && <span className="muted">(edited)</span>}
        {reply.accepted && (
          <span className="forum-badge is-answered">
            <Check size={11} aria-hidden="true" />
            Accepted answer
          </span>
        )}
      </div>
      {isEditing ? (
        <InlineReplyEditor reply={reply} onDone={onStopEdit} />
      ) : (
        <>
          <Markdown body={reply.body} />
          <ForumAttachments files={reply.attachments} headingLevel="h3" />
        </>
      )}
      {!isEditing && (
        <div className="forum-reply-footer">
          <button
            type="button"
            className={`forum-pill-btn ${reply.viewerVoted ? "is-active" : ""}`}
            aria-pressed={reply.viewerVoted}
            disabled={!writable || vote.isPending}
            onClick={() => {
              vote.mutate();
            }}
          >
            <ThumbsUp size={12} aria-hidden="true" />
            <span>Upvote</span>
            {reply.voteCount > 0 && (
              <span className="count">{reply.voteCount}</span>
            )}
          </button>
          <EmojiReactionBar
            reactions={reply.reactions}
            writable={writable}
            disabled={react.isPending}
            onToggle={(emoji, shouldRemove) => {
              react.mutate({ emoji, remove: shouldRemove });
            }}
          />
          {writable && (
            <div className="forum-reply-actions">
              <button type="button" className="text-button" onClick={onReplyTo}>
                <CornerDownRight size={12} aria-hidden="true" />
                Reply
              </button>
              {post.kind === "question" && (
                <button
                  type="button"
                  className="text-button"
                  disabled={accept.isPending}
                  onClick={() => {
                    accept.mutate();
                  }}
                >
                  {reply.accepted ? "Unaccept answer" : "Accept answer"}
                </button>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  onPromote({ replyId: reply.id, sourceBody: reply.body });
                }}
              >
                Promote to issue…
              </button>
              <button
                type="button"
                className="text-button"
                onClick={onStartEdit}
              >
                Edit
              </button>
              <button
                type="button"
                className="text-button danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate();
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      {accept.error !== null && <ErrorNotice error={accept.error} />}
      {remove.error !== null && <ErrorNotice error={remove.error} />}
    </div>
  );
}

export function ForumRepliesSection({
  post,
  writable,
  onPromote,
}: {
  post: PostDetail;
  writable: boolean;
  onPromote: (target: PromoteTarget) => void;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [replyParentId, setReplyParentId] = useState<string>();
  const refresh = useRefreshForum();
  const replyDraft = useDraft(`forum:reply:${post.id}`, "", {
    kind: "forum-reply",
    subject: post.id,
    saved: () => false,
    recheck: () => refresh(),
  });

  const postReply = useMutation({
    mutationFn: () =>
      api.forum.reply.mutate({
        actor: currentActor(),
        id: post.id,
        body: replyDraft.text,
        attachmentIds: replyDraft.attachments,
      }),
    onSuccess: async () => {
      replyDraft.reset();
      await refresh();
    },
  });

  const { topLevel, childrenByParent } = groupForumReplies(post.replies);

  return (
    <section
      className="forum-replies-section"
      aria-labelledby="replies-heading"
    >
      <div className="section-heading">
        <h2 id="replies-heading">Replies</h2>
        <span className="muted">
          {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}
        </span>
      </div>
      {topLevel.length === 0 ? (
        <p className="muted">No replies yet.</p>
      ) : (
        <div className="forum-replies-tree">
          {topLevel.map((top) => {
            const children = childrenByParent.get(top.id) ?? [];
            return (
              <div key={top.id} className="forum-reply-group">
                <ReplyItem
                  post={post}
                  reply={top}
                  writable={writable}
                  isEditing={editingId === top.id}
                  onStartEdit={() => {
                    setEditingId(top.id);
                  }}
                  onStopEdit={() => {
                    setEditingId(undefined);
                  }}
                  onReplyTo={() => {
                    setReplyParentId(top.id);
                  }}
                  onPromote={onPromote}
                />
                {(children.length > 0 || replyParentId === top.id) && (
                  <div className="forum-subreplies">
                    {children.map((child) => (
                      <ReplyItem
                        key={child.id}
                        post={post}
                        reply={child}
                        writable={writable}
                        isEditing={editingId === child.id}
                        onStartEdit={() => {
                          setEditingId(child.id);
                        }}
                        onStopEdit={() => {
                          setEditingId(undefined);
                        }}
                        onReplyTo={() => {
                          setReplyParentId(top.id);
                        }}
                        onPromote={onPromote}
                      />
                    ))}
                    {writable && replyParentId === top.id && (
                      <NestedReplyForm
                        postId={post.id}
                        parentReplyId={top.id}
                        onClose={() => {
                          setReplyParentId(undefined);
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {writable && (
        <form
          className="forum-reply-composer"
          onSubmit={(event) => {
            event.preventDefault();
            postReply.mutate();
          }}
        >
          <label htmlFor="forum-main-reply">Reply text</label>
          <MarkdownEditor
            id="forum-main-reply"
            label="Reply text"
            required
            placeholder="Write a reply…"
            value={replyDraft.text}
            onChange={replyDraft.setText}
            onAttachments={replyDraft.addAttachments}
          />
          {postReply.error !== null && <ErrorNotice error={postReply.error} />}
          <div className="forum-actions">
            <button
              type="submit"
              className="primary"
              disabled={postReply.isPending || replyDraft.text.trim() === ""}
            >
              {postReply.isPending ? "Saving…" : "Post reply"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
