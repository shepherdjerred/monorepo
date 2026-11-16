import type { Actor, Attachment, Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { MutationContext } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import { identifier } from "#domain/issue.ts";
import { ForumEmojiSchema, type ForumEmoji } from "#shared/forum.ts";
import { audit, presentActor } from "./issue-repository.ts";

const SubscriptionModeSchema = z.enum(["subscribed", "muted"]).nullable();

export function forumIdentifier(number: number): string {
  return `FM-${String(number)}`;
}

export function parseForumNumber(reference: string): number | null {
  const match = /^FM-([1-9]\d*)$/iu.exec(reference.trim());
  if (match?.[1] === undefined) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function viewerWhere(viewerActorKey?: string) {
  return viewerActorKey === undefined || viewerActorKey === ""
    ? { actorId: "" }
    : { actor: { key: viewerActorKey } };
}

export function postSummaryInclude(viewerActorKey?: string) {
  const viewerFilter = viewerWhere(viewerActorKey);
  return {
    creator: true,
    resolver: true,
    owner: true,
    pinnedBy: true,
    lastReplyAuthor: true,
    project: { select: { id: true, slug: true, name: true, color: true } },
    reactions: {
      include: { actor: { select: { key: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    },
    votes: {
      where: viewerFilter,
      select: { actorId: true },
    },
    issueLinks: {
      include: {
        issue: {
          include: {
            team: { select: { key: true } },
            state: { select: { name: true, type: true, color: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { issueId: "asc" }],
    },
    threadStates: {
      where: viewerFilter,
      select: { mode: true, lastReadAt: true },
    },
  } satisfies Prisma.ForumPostInclude;
}

export type PostSummaryRecord = Prisma.ForumPostGetPayload<{
  include: ReturnType<typeof postSummaryInclude>;
}>;

export function replyInclude(viewerActorKey?: string) {
  const viewerFilter = viewerWhere(viewerActorKey);
  return {
    author: true,
    votes: {
      where: viewerFilter,
      select: { actorId: true },
    },
    reactions: {
      include: { actor: { select: { key: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    },
    attachments: {
      where: { status: "committed" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    },
  } satisfies Prisma.ForumReplyInclude;
}

export type ReplyRecord = Prisma.ForumReplyGetPayload<{
  include: ReturnType<typeof replyInclude>;
}>;

export type GroupedReaction = {
  emoji: ForumEmoji;
  count: number;
  actorKeys: string[];
  viewerReacted: boolean;
};

export function groupReactions(
  reactions: readonly { emoji: string; actor: { key: string } }[],
  viewerActorKey?: string,
): GroupedReaction[] {
  const buckets = new Map<ForumEmoji, string[]>();
  for (const reaction of reactions) {
    const parsed = ForumEmojiSchema.safeParse(reaction.emoji);
    if (!parsed.success) continue;
    const keys = buckets.get(parsed.data) ?? [];
    if (!keys.includes(reaction.actor.key)) {
      keys.push(reaction.actor.key);
      buckets.set(parsed.data, keys);
    }
  }
  return ForumEmojiSchema.options.flatMap((emoji) => {
    const actorKeys = buckets.get(emoji);
    return actorKeys === undefined || actorKeys.length === 0
      ? []
      : [
          {
            emoji,
            count: actorKeys.length,
            actorKeys,
            viewerReacted:
              viewerActorKey !== undefined &&
              actorKeys.includes(viewerActorKey),
          },
        ];
  });
}

export function presentForumAttachment(attachment: Attachment) {
  return {
    ...attachment,
    createdAt: attachment.createdAt.toISOString(),
    url: `/attachments/${attachment.id}/${encodeURIComponent(attachment.filename)}`,
  };
}

function optionalActor(actor: Actor | null) {
  return actor === null ? null : presentActor(actor);
}

function optionalIso(date: Date | null) {
  return date === null ? null : date.toISOString();
}

function isNoticeExpired(post: PostSummaryRecord, now: Date): boolean {
  return (
    post.state === "open" &&
    post.kind === "notice" &&
    post.expiresAt !== null &&
    post.expiresAt <= now
  );
}

function viewerReadState(
  creatorKey: string,
  lastActivityAt: Date,
  threadState: { mode: string | null; lastReadAt: Date | null } | undefined,
  viewerActorKey?: string,
) {
  if (viewerActorKey === undefined || viewerActorKey === "") {
    return { viewerSubscription: null, unread: false };
  }
  const viewerSubscription = SubscriptionModeSchema.parse(
    threadState?.mode ?? null,
  );
  const unread =
    viewerSubscription !== "muted" &&
    (threadState === undefined
      ? creatorKey !== viewerActorKey
      : threadState.lastReadAt === null ||
        lastActivityAt > threadState.lastReadAt);
  return { viewerSubscription, unread };
}

export function presentPostSummary(
  post: PostSummaryRecord,
  {
    now = new Date(),
    viewerActorKey,
    searchSnippet,
  }: {
    now?: Date | undefined;
    viewerActorKey?: string | undefined;
    searchSnippet?: string | undefined;
  } = {},
) {
  const { viewerSubscription, unread } = viewerReadState(
    post.creator.key,
    post.lastActivityAt,
    post.threadStates[0],
    viewerActorKey,
  );
  return {
    id: post.id,
    number: post.number,
    identifier: forumIdentifier(post.number),
    kind: post.kind,
    title: post.title,
    body: post.body,
    scopes: post.scopes,
    exitCondition: post.exitCondition,
    expiresAt: optionalIso(post.expiresAt),
    state: post.state,
    creatorId: post.creatorId,
    creator: presentActor(post.creator),
    ownerId: post.ownerId,
    owner: optionalActor(post.owner),
    projectId: post.projectId,
    project: post.project,
    pinnedAt: optionalIso(post.pinnedAt),
    pinnedById: post.pinnedById,
    pinnedBy: optionalActor(post.pinnedBy),
    acceptedReplyId: post.acceptedReplyId,
    answered: post.kind === "question" && post.acceptedReplyId !== null,
    resolverId: post.resolverId,
    resolver: optionalActor(post.resolver),
    resolutionNote: post.resolutionNote,
    resolvedAt: optionalIso(post.resolvedAt),
    editedAt: optionalIso(post.editedAt),
    replyCount: post.replyCount,
    voteCount: post.voteCount,
    lastActivityAt: post.lastActivityAt.toISOString(),
    lastReplyAt: optionalIso(post.lastReplyAt),
    lastReplyAuthorId: post.lastReplyAuthorId,
    lastReplyAuthor: optionalActor(post.lastReplyAuthor),
    revision: post.revision,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    expired: isNoticeExpired(post, now),
    reactions: groupReactions(post.reactions, viewerActorKey),
    linkedIssues: post.issueLinks.map(({ issue }) => ({
      identifier: identifier(issue.team.key, issue.number),
      id: issue.id,
      title: issue.title,
      state: issue.state,
    })),
    viewerVoted: post.votes.length > 0,
    viewerSubscription,
    unread,
    ...(searchSnippet === undefined ? {} : { searchSnippet }),
  };
}

export function presentReply(
  reply: ReplyRecord,
  acceptedReplyId: string | null,
  viewerActorKey?: string,
) {
  const deleted = reply.deletedAt !== null;
  return {
    id: reply.id,
    postId: reply.postId,
    parentReplyId: reply.parentReplyId,
    authorId: reply.authorId,
    author: presentActor(reply.author),
    body: deleted ? "" : reply.body,
    createdAt: reply.createdAt.toISOString(),
    editedAt: optionalIso(reply.editedAt),
    deletedAt: optionalIso(reply.deletedAt),
    deleted,
    accepted: acceptedReplyId === reply.id,
    voteCount: reply.voteCount,
    viewerVoted: reply.votes.length > 0,
    reactions: deleted ? [] : groupReactions(reply.reactions, viewerActorKey),
    attachments: deleted
      ? []
      : reply.attachments.map((item) => presentForumAttachment(item)),
  };
}

export async function findPost(
  db: Prisma.TransactionClient,
  reference: string,
  viewerActorKey?: string,
) {
  const number = parseForumNumber(reference);
  const post = await db.forumPost.findUnique({
    where: number === null ? { id: reference.trim() } : { number },
    include: postSummaryInclude(viewerActorKey),
  });
  if (post === null)
    throw new TrackerError("NOT_FOUND", "Forum post not found");
  return post;
}

export async function lockPost(
  db: Prisma.TransactionClient,
  reference: string,
  expectedRevision?: number,
  viewerActorKey?: string,
) {
  const number = parseForumNumber(reference);
  const rows =
    number === null
      ? await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "ForumPost" WHERE "id" = ${reference.trim()} FOR UPDATE`
      : await db.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "ForumPost" WHERE "number" = ${number} FOR UPDATE`;
  const locked = rows[0];
  if (locked === undefined)
    throw new TrackerError("NOT_FOUND", "Forum post not found");
  const post = await db.forumPost.findUnique({
    where: { id: locked.id },
    include: postSummaryInclude(viewerActorKey),
  });
  if (post === null)
    throw new TrackerError("NOT_FOUND", "Forum post not found");
  if (expectedRevision !== undefined && expectedRevision !== post.revision)
    throw new TrackerError(
      "CONFLICT",
      "Forum post changed; reload before updating",
    );
  return post;
}

export async function commitForumAttachments(
  context: MutationContext,
  ids: string[],
  forumPostId: string,
  forumReplyId?: string,
) {
  for (const id of [...new Set(ids)].sort()) {
    await context.db
      .$queryRaw`SELECT "id" FROM "Attachment" WHERE "id" = ${id} FOR UPDATE`;
    const attachment = await context.db.attachment.findUnique({
      where: { id },
    });
    if (
      attachment !== null &&
      attachment.status === "committed" &&
      attachment.forumPostId === forumPostId &&
      (attachment.forumReplyId ?? undefined) === forumReplyId
    ) {
      continue;
    }
    if (
      attachment?.uploaderId !== context.actor.id ||
      attachment.status !== "staged"
    )
      throw new TrackerError(
        "BAD_REQUEST",
        "Attachment is unavailable or already committed",
      );
    await context.db.attachment.update({
      where: { id },
      data: {
        forumPostId,
        ...(forumReplyId === undefined ? {} : { forumReplyId }),
        status: "committed",
      },
    });
  }
}

export async function autoSubscribeActor(
  db: Prisma.TransactionClient,
  postId: string,
  actorId: string,
  lastReadAt?: Date,
) {
  const where = { postId_actorId: { postId, actorId } };
  const existing = await db.forumThreadState.findUnique({ where });
  if (existing === null) {
    await db.forumThreadState.create({
      data: {
        postId,
        actorId,
        mode: "subscribed",
        ...(lastReadAt === undefined ? {} : { lastReadAt }),
      },
    });
    return;
  }
  await db.forumThreadState.update({
    where,
    data: {
      mode: existing.mode === "muted" ? "muted" : "subscribed",
      ...(lastReadAt === undefined ? {} : { lastReadAt }),
    },
  });
}

export async function touchActorReadAt(
  db: Prisma.TransactionClient,
  postId: string,
  actorId: string,
  lastReadAt: Date,
) {
  await db.forumThreadState.upsert({
    where: { postId_actorId: { postId, actorId } },
    create: { postId, actorId, lastReadAt },
    update: { lastReadAt },
  });
}

export async function recomputePostReplySummary(
  db: Prisma.TransactionClient,
  postId: string,
) {
  const [replyCount, latest] = await Promise.all([
    db.forumReply.count({ where: { postId, deletedAt: null } }),
    db.forumReply.findFirst({
      where: { postId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true, authorId: true },
    }),
  ]);
  return {
    replyCount,
    lastReplyAt: latest?.createdAt ?? null,
    lastReplyAuthorId: latest?.authorId ?? null,
  };
}

export async function lockReplyParentPost(
  db: Prisma.TransactionClient,
  replyId: string,
) {
  const initial = await db.forumReply.findUnique({
    where: { id: replyId },
    select: { id: true, postId: true },
  });
  if (initial === null)
    throw new TrackerError("NOT_FOUND", "Forum reply not found");
  return lockPost(db, initial.postId);
}

export async function touchAndPresentAuditedPost(
  ctx: MutationContext,
  params: {
    beforeRecord: PostSummaryRecord;
    viewerActorKey: string;
    now: Date;
    action: string;
  },
) {
  const { beforeRecord, viewerActorKey, now, action } = params;
  await touchActorReadAt(ctx.db, beforeRecord.id, ctx.actor.id, now);
  const hydrated = await ctx.db.forumPost.findUniqueOrThrow({
    where: { id: beforeRecord.id },
    include: postSummaryInclude(viewerActorKey),
  });
  const after = presentPostSummary(hydrated, { now, viewerActorKey });
  await audit(ctx, {
    entityType: "forum-post",
    entityId: beforeRecord.id,
    action,
    before: presentPostSummary(beforeRecord, { now }),
    after,
  });
  return after;
}
