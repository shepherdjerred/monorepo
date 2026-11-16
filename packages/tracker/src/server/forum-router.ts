import { TRPCError } from "@trpc/server";
import {
  AcceptForumReplySchema,
  ClaimForumNoticeSchema,
  CreateForumPostSchema,
  DeleteForumReplySchema,
  ForumInboxSchema,
  ForumIssueLinkSchema,
  ForumListSchema,
  ForumReferenceSchema,
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
import { MutationSchema } from "#shared/schema.ts";
import { procedure, t } from "./rpc.ts";

const forumProcedure = procedure.use(async ({ ctx, next }) => {
  if (!(await ctx.forumEnabled()))
    throw new TRPCError({ code: "FORBIDDEN", message: "Forum is disabled" });
  return next();
});

const forumMutation = forumProcedure
  .input(MutationSchema)
  .use(async ({ ctx, next }) => {
    if (!(await ctx.writesEnabled()))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Tracker writes are paused",
      });
    return next();
  });

export const forumRouter = t.router({
  list: forumProcedure
    .input(ForumListSchema)
    .query(({ ctx, input }) => ctx.forum.list(input)),
  search: forumProcedure
    .input(
      ForumListSchema.extend({
        state: ForumListSchema.shape.state.default("all"),
      }),
    )
    .query(({ ctx, input }) => ctx.forum.list(input)),
  byId: forumProcedure
    .input(ForumReferenceSchema)
    .query(({ ctx, input }) => ctx.forum.byId(input.id, input.viewerActorKey)),
  inbox: forumProcedure
    .input(ForumInboxSchema)
    .query(({ ctx, input }) => ctx.forum.inbox(input)),
  scopes: forumProcedure.query(({ ctx }) => ctx.forum.scopes()),
  create: forumMutation
    .input(CreateForumPostSchema)
    .mutation(({ ctx, input }) => ctx.forum.create(input, ctx.requestId)),
  update: forumMutation
    .input(UpdateForumPostSchema)
    .mutation(({ ctx, input }) => ctx.forum.update(input, ctx.requestId)),
  reply: forumMutation
    .input(ReplyForumSchema)
    .mutation(({ ctx, input }) => ctx.forum.reply(input, ctx.requestId)),
  updateReply: forumMutation
    .input(UpdateForumReplySchema)
    .mutation(({ ctx, input }) => ctx.forum.updateReply(input, ctx.requestId)),
  deleteReply: forumMutation
    .input(DeleteForumReplySchema)
    .mutation(({ ctx, input }) => ctx.forum.deleteReply(input, ctx.requestId)),
  resolve: forumMutation
    .input(ResolveForumSchema)
    .mutation(({ ctx, input }) => ctx.forum.resolve(input, ctx.requestId)),
  reopen: forumMutation
    .input(ReopenForumSchema)
    .mutation(({ ctx, input }) => ctx.forum.reopen(input, ctx.requestId)),
  pin: forumMutation
    .input(PinForumSchema)
    .mutation(({ ctx, input }) => ctx.forum.pin(input, ctx.requestId)),
  acceptReply: forumMutation
    .input(AcceptForumReplySchema)
    .mutation(({ ctx, input }) => ctx.forum.acceptReply(input, ctx.requestId)),
  claim: forumMutation
    .input(ClaimForumNoticeSchema)
    .mutation(({ ctx, input }) => ctx.forum.claim(input, ctx.requestId)),
  handoff: forumMutation
    .input(HandoffForumNoticeSchema)
    .mutation(({ ctx, input }) => ctx.forum.handoff(input, ctx.requestId)),
  vote: forumMutation
    .input(VoteForumSchema)
    .mutation(({ ctx, input }) => ctx.forum.vote(input, ctx.requestId)),
  react: forumMutation
    .input(ReactForumSchema)
    .mutation(({ ctx, input }) => ctx.forum.react(input, ctx.requestId)),
  subscribe: forumMutation
    .input(SubscribeForumSchema)
    .mutation(({ ctx, input }) => ctx.forum.subscribe(input, ctx.requestId)),
  markRead: forumMutation
    .input(MarkForumReadSchema)
    .mutation(({ ctx, input }) => ctx.forum.markRead(input, ctx.requestId)),
  linkIssue: forumMutation
    .input(ForumIssueLinkSchema)
    .mutation(({ ctx, input }) => ctx.forum.linkIssue(input, ctx.requestId)),
  unlinkIssue: forumMutation
    .input(ForumIssueLinkSchema)
    .mutation(({ ctx, input }) => ctx.forum.unlinkIssue(input, ctx.requestId)),
  promoteToIssue: forumMutation
    .input(PromoteForumToIssueSchema)
    .mutation(({ ctx, input }) =>
      ctx.forum.promoteToIssue(input, ctx.requestId),
    ),
});
