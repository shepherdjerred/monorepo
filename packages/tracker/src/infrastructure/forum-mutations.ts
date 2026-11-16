import type { MutationContext } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import {
  CreateForumPostSchema,
  type DeleteForumReplyInput,
  type ReactForumInput,
  type UpdateForumPostInput,
  type VoteForumInput,
} from "#shared/forum.ts";
import {
  autoSubscribeActor,
  commitForumAttachments,
  groupReactions,
  lockPost,
  lockReplyParentPost,
  postSummaryInclude,
  presentPostSummary,
  recomputePostReplySummary,
  touchActorReadAt,
  type PostSummaryRecord,
} from "./forum-repository.ts";
import { audit, resolveAssignee, resolveProject } from "./issue-repository.ts";

function mergedPostCandidate(
  before: ReturnType<typeof presentPostSummary>,
  input: UpdateForumPostInput,
) {
  const parsed = CreateForumPostSchema.safeParse({
    actor: input.actor,
    kind: before.kind,
    title: input.title ?? before.title,
    body: input.body ?? before.body,
    scopes: input.scopes ?? before.scopes,
    exitCondition:
      input.exitCondition === undefined
        ? before.exitCondition
        : input.exitCondition,
    expiresAt:
      input.expiresAt === undefined ? before.expiresAt : input.expiresAt,
    ownerKey:
      input.ownerKey === undefined
        ? (before.owner?.key ?? null)
        : input.ownerKey,
    projectSlug:
      input.projectSlug === undefined
        ? (before.project?.slug ?? null)
        : input.projectSlug,
  });
  if (!parsed.success)
    throw new TrackerError(
      "BAD_REQUEST",
      parsed.error.issues.map(({ message }) => message).join("; "),
    );
  return parsed.data;
}

export async function updateForumPost(
  ctx: MutationContext,
  input: UpdateForumPostInput,
) {
  const beforeRecord: PostSummaryRecord = await lockPost(
    ctx.db,
    input.id,
    input.expectedRevision,
    input.actor.key,
  );
  const before = presentPostSummary(beforeRecord);
  const merged = mergedPostCandidate(before, input);
  const nextOwnerId =
    input.ownerKey === undefined
      ? before.ownerId
      : ((await resolveAssignee(ctx.db, input.ownerKey)) ?? null);
  const nextProjectId =
    input.projectSlug === undefined
      ? before.projectId
      : ((await resolveProject(ctx.db, input.projectSlug)) ?? null);
  const now = new Date();
  const contentEdited =
    merged.title !== before.title ||
    merged.body !== before.body ||
    (merged.exitCondition ?? null) !== before.exitCondition;
  await commitForumAttachments(ctx, input.attachmentIds, before.id);
  await ctx.db.forumPost.update({
    where: { id: before.id },
    data: {
      title: merged.title,
      body: merged.body,
      scopes: [...new Set(merged.scopes)],
      exitCondition: merged.exitCondition ?? null,
      expiresAt: merged.expiresAt == null ? null : new Date(merged.expiresAt),
      ownerId: nextOwnerId,
      projectId: nextProjectId,
      ...(contentEdited ? { editedAt: now } : {}),
      lastActivityAt: now,
      revision: { increment: 1 },
    },
  });
  await touchActorReadAt(ctx.db, before.id, ctx.actor.id, now);
  if (nextOwnerId !== null && nextOwnerId !== before.ownerId) {
    await autoSubscribeActor(ctx.db, before.id, nextOwnerId);
  }
  const hydrated = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: before.id },
    include: postSummaryInclude(input.actor.key),
  });
  const after = presentPostSummary(hydrated, {
    now,
    viewerActorKey: input.actor.key,
  });
  await audit(ctx, {
    entityType: "forum-post",
    entityId: before.id,
    action: "updated",
    before,
    after,
  });
  return after;
}

export async function deleteForumReply(
  ctx: MutationContext,
  input: DeleteForumReplyInput,
) {
  const post = await lockReplyParentPost(ctx.db, input.replyId);
  const reply = await ctx.db.forumReply.findUnique({
    where: { id: input.replyId },
  });
  if (reply === null)
    throw new TrackerError("NOT_FOUND", "Forum reply not found");
  if (reply.deletedAt !== null)
    throw new TrackerError("BAD_REQUEST", "Reply is already deleted");
  const childCount = await ctx.db.forumReply.count({
    where: { parentReplyId: reply.id },
  });
  const now = new Date();
  if (childCount === 0) {
    await ctx.db.forumReply.delete({ where: { id: reply.id } });
  } else {
    await Promise.all([
      ctx.db.attachment.updateMany({
        where: { forumReplyId: reply.id },
        data: { forumReplyId: null },
      }),
      ctx.db.forumReaction.deleteMany({ where: { replyId: reply.id } }),
      ctx.db.forumReplyVote.deleteMany({ where: { replyId: reply.id } }),
      ctx.db.forumReply.update({
        where: { id: reply.id },
        data: { body: "", deletedAt: now, voteCount: 0 },
      }),
    ]);
  }
  const summary = await recomputePostReplySummary(ctx.db, post.id);
  await ctx.db.forumPost.update({
    where: { id: post.id },
    data: {
      ...summary,
      ...(post.acceptedReplyId === reply.id ? { acceptedReplyId: null } : {}),
    },
  });
  await audit(ctx, {
    entityType: "forum-reply",
    entityId: post.id,
    action: "deleted",
    before: {
      id: reply.id,
      body: reply.body,
      parentReplyId: reply.parentReplyId,
    },
    after: { id: reply.id, tombstoned: childCount > 0 },
  });
  return { deleted: true, tombstoned: childCount > 0, postId: post.id };
}

export async function claimOrHandoffNotice(
  ctx: MutationContext,
  options: {
    id: string;
    actorKey: string;
    action: "claimed" | "handed-off";
    nextOwnerKey: string | null;
    note?: string | undefined;
  },
) {
  const before = await lockPost(
    ctx.db,
    options.id,
    undefined,
    options.actorKey,
  );
  if (before.kind !== "notice")
    throw new TrackerError(
      "BAD_REQUEST",
      "Only notices have coordination owners",
    );
  const nextOwnerId =
    options.nextOwnerKey === null
      ? null
      : options.nextOwnerKey === options.actorKey
        ? ctx.actor.id
        : ((await resolveAssignee(ctx.db, options.nextOwnerKey)) ?? null);
  const now = new Date();
  if (options.note !== undefined) {
    await ctx.db.forumReply.create({
      data: {
        postId: before.id,
        authorId: ctx.actor.id,
        body: options.note,
        createdAt: now,
      },
    });
  }
  const replyPatch =
    options.note === undefined
      ? {}
      : {
          replyCount: before.replyCount + 1,
          lastReplyAt: now,
          lastReplyAuthorId: ctx.actor.id,
        };
  await ctx.db.forumPost.update({
    where: { id: before.id },
    data: { ownerId: nextOwnerId, lastActivityAt: now, ...replyPatch },
  });
  await autoSubscribeActor(ctx.db, before.id, ctx.actor.id, now);
  if (nextOwnerId !== null && nextOwnerId !== ctx.actor.id) {
    await autoSubscribeActor(ctx.db, before.id, nextOwnerId);
  }
  const refreshed = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: before.id },
    include: postSummaryInclude(options.actorKey),
  });
  const after = presentPostSummary(refreshed, {
    now,
    viewerActorKey: options.actorKey,
  });
  await audit(ctx, {
    entityType: "forum-post",
    entityId: before.id,
    action: options.action,
    before: presentPostSummary(before, { now }),
    after,
  });
  return after;
}

async function voteOnPost(
  ctx: MutationContext,
  postRef: string,
  remove: boolean,
  note?: string,
) {
  const post = await lockPost(ctx.db, postRef);
  const where = { postId_actorId: { postId: post.id, actorId: ctx.actor.id } };
  const before = await ctx.db.forumPostVote.findUnique({ where });
  if (remove) {
    await ctx.db.forumPostVote.deleteMany({
      where: { postId: post.id, actorId: ctx.actor.id },
    });
  } else {
    await ctx.db.forumPostVote.upsert({
      where,
      create: {
        postId: post.id,
        actorId: ctx.actor.id,
        note: note ?? null,
      },
      update: note === undefined ? {} : { note },
    });
  }
  const voteCount = await ctx.db.forumPostVote.count({
    where: { postId: post.id },
  });
  await ctx.db.forumPost.update({
    where: { id: post.id },
    data: { voteCount },
  });
  await audit(ctx, {
    entityType: "forum-vote",
    entityId: post.id,
    action: remove ? "removed" : "cast",
    ...(before === null ? {} : { before }),
    after: {
      target: "post",
      postId: post.id,
      voteCount,
      note: remove ? null : (note ?? before?.note ?? null),
    },
  });
  return {
    target: "post" as const,
    postId: post.id,
    replyId: null,
    voteCount,
    viewerVoted: !remove,
  };
}

async function voteOnReply(
  ctx: MutationContext,
  replyId: string,
  remove: boolean,
) {
  const reply = await ctx.db.forumReply.findUnique({ where: { id: replyId } });
  if (reply === null)
    throw new TrackerError("NOT_FOUND", "Forum reply not found");
  if (reply.deletedAt !== null)
    throw new TrackerError("BAD_REQUEST", "Cannot vote on a deleted reply");
  await lockPost(ctx.db, reply.postId);
  if (remove) {
    await ctx.db.forumReplyVote.deleteMany({
      where: { replyId: reply.id, actorId: ctx.actor.id },
    });
  } else {
    await ctx.db.forumReplyVote.upsert({
      where: { replyId_actorId: { replyId: reply.id, actorId: ctx.actor.id } },
      create: { replyId: reply.id, actorId: ctx.actor.id },
      update: {},
    });
  }
  const voteCount = await ctx.db.forumReplyVote.count({
    where: { replyId: reply.id },
  });
  await ctx.db.forumReply.update({
    where: { id: reply.id },
    data: { voteCount },
  });
  await audit(ctx, {
    entityType: "forum-vote",
    entityId: reply.postId,
    action: remove ? "removed" : "cast",
    after: {
      target: "reply",
      postId: reply.postId,
      replyId: reply.id,
      voteCount,
    },
  });
  return {
    target: "reply" as const,
    postId: reply.postId,
    replyId: reply.id,
    voteCount,
    viewerVoted: !remove,
  };
}

export type ForumVoteResult =
  | Awaited<ReturnType<typeof voteOnPost>>
  | Awaited<ReturnType<typeof voteOnReply>>;

export function voteOnForum(
  ctx: MutationContext,
  input: VoteForumInput,
): Promise<ForumVoteResult> {
  if (input.id !== undefined) {
    return voteOnPost(ctx, input.id, input.remove, input.note);
  }
  if (input.replyId === undefined)
    throw new TrackerError("BAD_REQUEST", "Specify id or replyId");
  return voteOnReply(ctx, input.replyId, input.remove);
}

async function reactOnPost(
  ctx: MutationContext,
  postRef: string,
  input: ReactForumInput,
) {
  const { emoji, remove } = input;
  const actorKey = input.actor.key;
  const post = await lockPost(ctx.db, postRef);
  if (remove) {
    await ctx.db.forumReaction.deleteMany({
      where: { postId: post.id, actorId: ctx.actor.id, emoji },
    });
  } else {
    const existing = await ctx.db.forumReaction.findFirst({
      where: { postId: post.id, actorId: ctx.actor.id, emoji },
    });
    if (existing === null) {
      await ctx.db.forumReaction.create({
        data: { postId: post.id, actorId: ctx.actor.id, emoji },
      });
    }
  }
  const rows = await ctx.db.forumReaction.findMany({
    where: { postId: post.id },
    include: { actor: { select: { key: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  await audit(ctx, {
    entityType: "forum-reaction",
    entityId: post.id,
    action: remove ? "removed" : "added",
    after: { target: "post", postId: post.id, emoji },
  });
  return {
    target: "post" as const,
    postId: post.id,
    replyId: null,
    reactions: groupReactions(rows, actorKey),
  };
}

async function reactOnReply(
  ctx: MutationContext,
  replyId: string,
  input: ReactForumInput,
) {
  const { emoji, remove } = input;
  const actorKey = input.actor.key;
  const reply = await ctx.db.forumReply.findUnique({ where: { id: replyId } });
  if (reply === null)
    throw new TrackerError("NOT_FOUND", "Forum reply not found");
  if (reply.deletedAt !== null)
    throw new TrackerError("BAD_REQUEST", "Cannot react to a deleted reply");
  await lockPost(ctx.db, reply.postId);
  if (remove) {
    await ctx.db.forumReaction.deleteMany({
      where: { replyId: reply.id, actorId: ctx.actor.id, emoji },
    });
  } else {
    const existing = await ctx.db.forumReaction.findFirst({
      where: { replyId: reply.id, actorId: ctx.actor.id, emoji },
    });
    if (existing === null) {
      await ctx.db.forumReaction.create({
        data: { replyId: reply.id, actorId: ctx.actor.id, emoji },
      });
    }
  }
  const rows = await ctx.db.forumReaction.findMany({
    where: { replyId: reply.id },
    include: { actor: { select: { key: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  await audit(ctx, {
    entityType: "forum-reaction",
    entityId: reply.postId,
    action: remove ? "removed" : "added",
    after: { target: "reply", postId: reply.postId, replyId: reply.id, emoji },
  });
  return {
    target: "reply" as const,
    postId: reply.postId,
    replyId: reply.id,
    reactions: groupReactions(rows, actorKey),
  };
}

export type ForumReactResult =
  | Awaited<ReturnType<typeof reactOnPost>>
  | Awaited<ReturnType<typeof reactOnReply>>;

export function reactOnForum(
  ctx: MutationContext,
  input: ReactForumInput,
): Promise<ForumReactResult> {
  if (input.id !== undefined) {
    return reactOnPost(ctx, input.id, input);
  }
  if (input.replyId === undefined)
    throw new TrackerError("BAD_REQUEST", "Specify id or replyId");
  return reactOnReply(ctx, input.replyId, input);
}
