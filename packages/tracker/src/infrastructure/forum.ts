import type { Prisma } from "#generated/prisma/client.ts";
import type { UnitOfWork } from "#application/unit-of-work.ts";
import {
  AcceptForumReplySchema,
  ClaimForumNoticeSchema,
  CreateForumPostSchema,
  DeleteForumReplySchema,
  ForumInboxSchema,
  ForumIssueLinkSchema,
  ForumListSchema,
  HandoffForumNoticeSchema,
  MarkForumReadSchema,
  PinForumSchema,
  PromoteForumToIssueSchema,
  ReactForumSchema,
  ReopenForumSchema,
  ReplyForumSchema,
  ResolveForumSchema,
  SubscribeForumSchema,
  UpdateForumPostSchema,
  UpdateForumReplySchema,
  VoteForumSchema,
} from "#shared/forum.ts";
import type { z } from "zod";
import type { Database } from "./database.ts";
import {
  linkForumIssue,
  promoteForumToIssue,
  unlinkForumIssue,
} from "./forum-issues.ts";
import {
  listForumInbox,
  listForumPosts,
  listForumScopes,
} from "./forum-list.ts";
import {
  claimOrHandoffNotice,
  deleteForumReply,
  reactOnForum,
  updateForumPost,
  voteOnForum,
} from "./forum-mutations.ts";
import {
  findPost,
  postSummaryInclude,
  presentForumAttachment,
  presentPostSummary,
  presentReply,
  replyInclude,
} from "./forum-repository.ts";
import {
  acceptForumAnswer,
  createForumPost,
  createForumReply,
  pinForumPost,
  setForumPostState,
  updateForumReply,
} from "./forum-write.ts";
import { presentActor } from "./issue-repository.ts";

export class Forum {
  constructor(
    private readonly database: Database,
    private readonly unit: UnitOfWork,
  ) {}

  list(input: z.input<typeof ForumListSchema>, now = new Date()) {
    return listForumPosts(this.database, ForumListSchema.parse(input), now);
  }

  inbox(input: z.input<typeof ForumInboxSchema>, now = new Date()) {
    return listForumInbox(this.database, ForumInboxSchema.parse(input), now);
  }

  scopes() {
    return listForumScopes(this.database);
  }

  async byId(
    reference: string,
    viewerActorKey?: string,
    db: Prisma.TransactionClient = this.database,
  ) {
    const post = await findPost(db, reference, viewerActorKey);
    const [attachments, votes, replies] = await Promise.all([
      db.attachment.findMany({
        where: {
          forumPostId: post.id,
          forumReplyId: null,
          status: "committed",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      db.forumPostVote.findMany({
        where: { postId: post.id },
        include: { actor: true },
        orderBy: [{ createdAt: "asc" }, { actorId: "asc" }],
      }),
      db.forumReply.findMany({
        where: { postId: post.id },
        include: replyInclude(viewerActorKey),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      ...presentPostSummary(post, { viewerActorKey }),
      attachments: attachments.map((item) => presentForumAttachment(item)),
      votes: votes.map((vote) => ({
        actor: presentActor(vote.actor),
        note: vote.note,
        createdAt: vote.createdAt.toISOString(),
      })),
      replies: replies.map((reply) =>
        presentReply(reply, post.acceptedReplyId, viewerActorKey),
      ),
    };
  }

  create(rawInput: z.input<typeof CreateForumPostSchema>, requestId: string) {
    const input = CreateForumPostSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      createForumPost(ctx, input),
    );
  }

  update(rawInput: z.input<typeof UpdateForumPostSchema>, requestId: string) {
    const input = UpdateForumPostSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      updateForumPost(ctx, input),
    );
  }

  reply(rawInput: z.input<typeof ReplyForumSchema>, requestId: string) {
    const input = ReplyForumSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      createForumReply(ctx, input),
    );
  }

  updateReply(
    rawInput: z.input<typeof UpdateForumReplySchema>,
    requestId: string,
  ) {
    const input = UpdateForumReplySchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      updateForumReply(ctx, input),
    );
  }

  deleteReply(
    rawInput: z.input<typeof DeleteForumReplySchema>,
    requestId: string,
  ) {
    const input = DeleteForumReplySchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      deleteForumReply(ctx, input),
    );
  }

  resolve(rawInput: z.input<typeof ResolveForumSchema>, requestId: string) {
    const input = ResolveForumSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      setForumPostState(ctx, input, "resolved", input.note),
    );
  }

  reopen(rawInput: z.input<typeof ReopenForumSchema>, requestId: string) {
    const input = ReopenForumSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      setForumPostState(ctx, input, "open", null),
    );
  }

  pin(rawInput: z.input<typeof PinForumSchema>, requestId: string) {
    const input = PinForumSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      pinForumPost(ctx, input),
    );
  }

  acceptReply(
    rawInput: z.input<typeof AcceptForumReplySchema>,
    requestId: string,
  ) {
    const input = AcceptForumReplySchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      acceptForumAnswer(ctx, input),
    );
  }

  claim(rawInput: z.input<typeof ClaimForumNoticeSchema>, requestId: string) {
    const input = ClaimForumNoticeSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      claimOrHandoffNotice(ctx, {
        id: input.id,
        actorKey: input.actor.key,
        action: "claimed",
        nextOwnerKey: input.actor.key,
        note: input.note,
      }),
    );
  }

  handoff(
    rawInput: z.input<typeof HandoffForumNoticeSchema>,
    requestId: string,
  ) {
    const input = HandoffForumNoticeSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      claimOrHandoffNotice(ctx, {
        id: input.id,
        actorKey: input.actor.key,
        action: "handed-off",
        nextOwnerKey: input.toActorKey,
        note: input.note,
      }),
    );
  }

  vote(rawInput: z.input<typeof VoteForumSchema>, requestId: string) {
    const input = VoteForumSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      voteOnForum(ctx, input),
    );
  }

  react(rawInput: z.input<typeof ReactForumSchema>, requestId: string) {
    const input = ReactForumSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      reactOnForum(ctx, input),
    );
  }

  subscribe(rawInput: z.input<typeof SubscribeForumSchema>, requestId: string) {
    const input = SubscribeForumSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, async (ctx) => {
      const post = await findPost(ctx.db, input.id, input.actor.key);
      await ctx.db.forumThreadState.upsert({
        where: { postId_actorId: { postId: post.id, actorId: ctx.actor.id } },
        create: { postId: post.id, actorId: ctx.actor.id, mode: input.mode },
        update: { mode: input.mode },
      });
      const hydrated = await ctx.db.forumPost.findUniqueOrThrow({
        where: { id: post.id },
        include: postSummaryInclude(input.actor.key),
      });
      return presentPostSummary(hydrated, { viewerActorKey: input.actor.key });
    });
  }

  markRead(rawInput: z.input<typeof MarkForumReadSchema>, requestId: string) {
    const input = MarkForumReadSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, async (ctx) => {
      const post = await findPost(ctx.db, input.id, input.actor.key);
      const now = new Date();
      const lastReadAt =
        input.readAt === null
          ? null
          : input.readAt === undefined
            ? new Date(Math.max(now.getTime(), post.lastActivityAt.getTime()))
            : new Date(input.readAt);
      await ctx.db.forumThreadState.upsert({
        where: { postId_actorId: { postId: post.id, actorId: ctx.actor.id } },
        create: { postId: post.id, actorId: ctx.actor.id, lastReadAt },
        update: { lastReadAt },
      });
      const hydrated = await ctx.db.forumPost.findUniqueOrThrow({
        where: { id: post.id },
        include: postSummaryInclude(input.actor.key),
      });
      return presentPostSummary(hydrated, {
        now,
        viewerActorKey: input.actor.key,
      });
    });
  }

  linkIssue(rawInput: z.input<typeof ForumIssueLinkSchema>, requestId: string) {
    const input = ForumIssueLinkSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      linkForumIssue(ctx, input),
    );
  }

  unlinkIssue(
    rawInput: z.input<typeof ForumIssueLinkSchema>,
    requestId: string,
  ) {
    const input = ForumIssueLinkSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, (ctx) =>
      unlinkForumIssue(ctx, input),
    );
  }

  promoteToIssue(
    rawInput: z.input<typeof PromoteForumToIssueSchema>,
    requestId: string,
  ) {
    const input = PromoteForumToIssueSchema.parse(rawInput);
    return this.unit.run(input.actor, requestId, async (ctx) => {
      const { issue, postId } = await promoteForumToIssue(ctx, input);
      const post = await this.byId(postId, input.actor.key, ctx.db);
      return { issue, post };
    });
  }
}
