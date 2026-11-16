import type { MutationContext } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import { identifier } from "#domain/issue.ts";
import type {
  AcceptForumReplyInput,
  CreateForumPostInput,
  PinForumInput,
  ReopenForumInput,
  ReplyForumInput,
  UpdateForumReplyInput,
} from "#shared/forum.ts";
import {
  autoSubscribeActor,
  commitForumAttachments,
  forumIdentifier,
  lockPost,
  postSummaryInclude,
  presentPostSummary,
  presentReply,
  recomputePostReplySummary,
  replyInclude,
  touchActorReadAt,
} from "./forum-repository.ts";
import {
  audit,
  findIssue,
  resolveAssignee,
  resolveProject,
} from "./issue-repository.ts";

export async function createForumPost(
  ctx: MutationContext,
  input: CreateForumPostInput,
) {
  const [ownerId = null, projectId = null] = await Promise.all([
    resolveAssignee(ctx.db, input.ownerKey),
    resolveProject(ctx.db, input.projectSlug),
  ]);
  const now = new Date();
  const pinned = input.pinned === true;
  const created = await ctx.db.forumPost.create({
    data: {
      kind: input.kind,
      title: input.title,
      body: input.body,
      scopes: [...new Set(input.scopes)],
      exitCondition: input.exitCondition ?? null,
      expiresAt: input.expiresAt == null ? null : new Date(input.expiresAt),
      creatorId: ctx.actor.id,
      ownerId,
      projectId,
      pinnedAt: pinned ? now : null,
      pinnedById: pinned ? ctx.actor.id : null,
      createdAt: now,
      lastActivityAt: now,
    },
  });
  await commitForumAttachments(ctx, input.attachmentIds, created.id);
  for (const issueIdentifier of new Set(input.linkedIssueIdentifiers)) {
    const issue = await findIssue(ctx.db, issueIdentifier);
    const issueIdent = identifier(issue.team.key, issue.number);
    await ctx.db.forumIssueLink.create({
      data: {
        postId: created.id,
        issueId: issue.id,
        createdById: ctx.actor.id,
      },
    });
    await audit(ctx, {
      entityType: "forum-issue-link",
      entityId: created.id,
      issueId: issue.id,
      issueIdentifier: issueIdent,
      action: "linked",
      after: {
        postId: created.id,
        postIdentifier: forumIdentifier(created.number),
        issueId: issue.id,
        issueIdentifier: issueIdent,
      },
    });
  }
  await autoSubscribeActor(ctx.db, created.id, ctx.actor.id, now);
  if (ownerId != null && ownerId !== ctx.actor.id) {
    await autoSubscribeActor(ctx.db, created.id, ownerId);
  }
  const hydrated = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: created.id },
    include: postSummaryInclude(input.actor.key),
  });
  const result = presentPostSummary(hydrated, {
    now,
    viewerActorKey: input.actor.key,
  });
  await audit(ctx, {
    entityType: "forum-post",
    entityId: created.id,
    action: "created",
    after: result,
  });
  return result;
}

export async function createForumReply(
  ctx: MutationContext,
  input: ReplyForumInput,
) {
  const post = await lockPost(ctx.db, input.id);
  if (input.parentReplyId != null) {
    const parent = await ctx.db.forumReply.findFirst({
      where: { id: input.parentReplyId, postId: post.id },
    });
    if (parent === null)
      throw new TrackerError(
        "NOT_FOUND",
        "Parent reply not found on this thread",
      );
    if (parent.parentReplyId !== null)
      throw new TrackerError(
        "BAD_REQUEST",
        "Replies can only be nested one level deep",
      );
    if (parent.deletedAt !== null)
      throw new TrackerError("BAD_REQUEST", "Cannot reply to a deleted reply");
  }
  const now = new Date();
  const created = await ctx.db.forumReply.create({
    data: {
      postId: post.id,
      parentReplyId: input.parentReplyId ?? null,
      authorId: ctx.actor.id,
      body: input.body,
      createdAt: now,
    },
  });
  await commitForumAttachments(ctx, input.attachmentIds, post.id, created.id);
  const summary = await recomputePostReplySummary(ctx.db, post.id);
  await ctx.db.forumPost.update({
    where: { id: post.id },
    data: { ...summary, lastActivityAt: now, updatedAt: now },
  });
  await autoSubscribeActor(ctx.db, post.id, ctx.actor.id, now);
  const hydrated = await ctx.db.forumReply.findUniqueOrThrow({
    where: { id: created.id },
    include: replyInclude(input.actor.key),
  });
  const result = presentReply(hydrated, post.acceptedReplyId, input.actor.key);
  await audit(ctx, {
    entityType: "forum-reply",
    entityId: post.id,
    action: "created",
    after: result,
  });
  return result;
}

export async function updateForumReply(
  ctx: MutationContext,
  input: UpdateForumReplyInput,
) {
  const initial = await ctx.db.forumReply.findUnique({
    where: { id: input.replyId },
    select: { id: true, postId: true },
  });
  if (initial === null)
    throw new TrackerError("NOT_FOUND", "Forum reply not found");
  const post = await lockPost(ctx.db, initial.postId);
  const before = await ctx.db.forumReply.findUnique({
    where: { id: input.replyId },
    include: replyInclude(input.actor.key),
  });
  if (before === null)
    throw new TrackerError("NOT_FOUND", "Forum reply not found");
  if (before.deletedAt !== null)
    throw new TrackerError("BAD_REQUEST", "Cannot edit a deleted reply");
  const now = new Date();
  await commitForumAttachments(ctx, input.attachmentIds, post.id, before.id);
  const updated = await ctx.db.forumReply.update({
    where: { id: before.id },
    data: { body: input.body, editedAt: now },
    include: replyInclude(input.actor.key),
  });
  await ctx.db.forumPost.update({
    where: { id: post.id },
    data: { lastActivityAt: now },
  });
  await touchActorReadAt(ctx.db, post.id, ctx.actor.id, now);
  const after = presentReply(updated, post.acceptedReplyId, input.actor.key);
  await audit(ctx, {
    entityType: "forum-reply",
    entityId: post.id,
    action: "updated",
    before: presentReply(before, post.acceptedReplyId, input.actor.key),
    after,
  });
  return after;
}

export async function pinForumPost(ctx: MutationContext, input: PinForumInput) {
  const beforeRecord = await lockPost(
    ctx.db,
    input.id,
    undefined,
    input.actor.key,
  );
  const now = new Date();
  const updated = await ctx.db.forumPost.update({
    where: { id: beforeRecord.id },
    data: {
      pinnedAt: input.pinned ? (beforeRecord.pinnedAt ?? now) : null,
      pinnedById: input.pinned ? ctx.actor.id : null,
    },
    include: postSummaryInclude(input.actor.key),
  });
  const after = presentPostSummary(updated, {
    now,
    viewerActorKey: input.actor.key,
  });
  await audit(ctx, {
    entityType: "forum-post",
    entityId: beforeRecord.id,
    action: input.pinned ? "pinned" : "unpinned",
    before: presentPostSummary(beforeRecord, { now }),
    after,
  });
  return after;
}

export async function acceptForumAnswer(
  ctx: MutationContext,
  input: AcceptForumReplyInput,
) {
  const beforeRecord = await lockPost(
    ctx.db,
    input.id,
    undefined,
    input.actor.key,
  );
  if (beforeRecord.kind !== "question")
    throw new TrackerError(
      "BAD_REQUEST",
      "Only question threads can accept an answer",
    );
  if (input.replyId !== null) {
    const reply = await ctx.db.forumReply.findFirst({
      where: { id: input.replyId, postId: beforeRecord.id },
    });
    if (reply === null)
      throw new TrackerError("NOT_FOUND", "Reply not found on this thread");
    if (reply.deletedAt !== null)
      throw new TrackerError("BAD_REQUEST", "Cannot accept a deleted reply");
  }
  const now = new Date();
  await ctx.db.forumPost.update({
    where: { id: beforeRecord.id },
    data: { acceptedReplyId: input.replyId, lastActivityAt: now },
  });
  await touchActorReadAt(ctx.db, beforeRecord.id, ctx.actor.id, now);
  const hydrated = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: beforeRecord.id },
    include: postSummaryInclude(input.actor.key),
  });
  const after = presentPostSummary(hydrated, {
    now,
    viewerActorKey: input.actor.key,
  });
  await audit(ctx, {
    entityType: "forum-post",
    entityId: beforeRecord.id,
    action: input.replyId === null ? "answer-unaccepted" : "answer-accepted",
    before: presentPostSummary(beforeRecord, { now }),
    after,
  });
  return after;
}

export async function setForumPostState(
  ctx: MutationContext,
  input: ReopenForumInput,
  state: "open" | "resolved",
  note: string | null,
) {
  const beforeRecord = await lockPost(
    ctx.db,
    input.id,
    input.expectedRevision,
    input.actor.key,
  );
  if (beforeRecord.state === state)
    throw new TrackerError("CONFLICT", `Post is already ${state}`);
  const now = new Date();
  await ctx.db.forumPost.update({
    where: { id: beforeRecord.id },
    data: {
      state,
      resolutionNote: note,
      resolverId: state === "resolved" ? ctx.actor.id : null,
      resolvedAt: state === "resolved" ? now : null,
      lastActivityAt: now,
      revision: { increment: 1 },
    },
  });
  await touchActorReadAt(ctx.db, beforeRecord.id, ctx.actor.id, now);
  const hydrated = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: beforeRecord.id },
    include: postSummaryInclude(input.actor.key),
  });
  const after = presentPostSummary(hydrated, {
    now,
    viewerActorKey: input.actor.key,
  });
  await audit(ctx, {
    entityType: "forum-post",
    entityId: beforeRecord.id,
    action: state === "open" ? "reopened" : "resolved",
    before: presentPostSummary(beforeRecord, { now }),
    after,
  });
  return after;
}
