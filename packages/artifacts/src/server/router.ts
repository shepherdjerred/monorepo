import {
  BoardIndexSchema,
  FeedbackClaimResponseSchema,
} from "#shared/contract.ts";
import { z } from "zod";
import {
  ArtifactDetailSchema,
  ArtifactListInputSchema,
  ArtifactRefInputSchema,
  ArtifactRenameInputSchema,
  ArtifactSummarySchema,
  BoardApplyOpsInputSchema,
  BoardArchiveInputSchema,
  BoardCreateInputSchema,
  BoardDocumentSchema,
  BoardKeepInputSchema,
  BoardListInputSchema,
  BoardRefInputSchema,
  BoardReplaceInputSchema,
  BoardSummarySchema,
  BoardUpdateInputSchema,
  CommentEditInputSchema,
  CommentRefInputSchema,
  FeedbackAckInputSchema,
  FeedbackAckOutputSchema,
  FeedbackClaimInputSchema,
  FeedbackPendingInputSchema,
  FeedbackPendingOutputSchema,
  FeedbackRedeliverInputSchema,
  FeedbackWaitersInputSchema,
  FeedbackWaitersOutputSchema,
  InboxListOutputSchema,
  MaintenanceCleanupOutputSchema,
  RotateTokenOutputSchema,
  ThreadCreateInputSchema,
  ThreadListInputSchema,
  ThreadRefInputSchema,
  ThreadReplyInputSchema,
  ThreadViewSchema,
  VersionRefInputSchema,
  VersionSummarySchema,
  VersionViewSchema,
} from "#shared/procedures.ts";
import { internalProcedure, mutation, procedure, t } from "./rpc.ts";

const Ok = z.strictObject({ ok: z.literal(true) });

const boardsRouter = t.router({
  list: procedure
    .input(BoardListInputSchema)
    .output(z.array(BoardSummarySchema))
    .query(({ ctx, input }) => ctx.services.boards.list(input)),
  get: procedure
    .input(BoardRefInputSchema)
    .output(
      z.strictObject({
        board: BoardSummarySchema,
        index: BoardIndexSchema,
        artifacts: z.array(ArtifactSummarySchema),
      }),
    )
    .query(({ ctx, input }) => ctx.services.boards.get(input.slug)),
  create: mutation
    .input(BoardCreateInputSchema)
    .output(BoardSummarySchema)
    .mutation(({ ctx, input }) =>
      ctx.services.boards.create(input, ctx.caller, ctx.requestId),
    ),
  update: mutation
    .input(BoardUpdateInputSchema)
    .output(BoardSummarySchema)
    .mutation(({ ctx, input }) =>
      ctx.services.boards.update(input, ctx.caller, ctx.requestId),
    ),
  archive: mutation
    .input(BoardArchiveInputSchema)
    .output(BoardSummarySchema)
    .mutation(({ ctx, input }) =>
      ctx.services.boards.archive(input, ctx.caller, ctx.requestId),
    ),
  setKeep: mutation
    .input(BoardKeepInputSchema)
    .output(BoardSummarySchema)
    .mutation(({ ctx, input }) =>
      ctx.services.boards.setKeep(input, ctx.caller, ctx.requestId),
    ),
  touch: mutation
    .input(BoardRefInputSchema)
    .output(Ok)
    .mutation(({ ctx, input }) => ctx.services.boards.touch(input.slug)),
  applyOps: mutation
    .input(BoardApplyOpsInputSchema)
    .output(BoardDocumentSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.boards.applyOps(input, ctx.caller, ctx.requestId),
    ),
  replace: mutation
    .input(BoardReplaceInputSchema)
    .output(BoardDocumentSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.boards.replace(input, ctx.caller, ctx.requestId),
    ),
});

const artifactsRouter = t.router({
  list: procedure
    .input(ArtifactListInputSchema)
    .output(z.array(ArtifactSummarySchema))
    .query(({ ctx, input }) => ctx.services.artifacts.list(input)),
  get: procedure
    .input(ArtifactRefInputSchema)
    .output(ArtifactDetailSchema)
    .query(({ ctx, input }) => ctx.services.artifacts.get(input.id)),
  rename: mutation
    .input(ArtifactRenameInputSchema)
    .output(ArtifactSummarySchema)
    .mutation(({ ctx, input }) =>
      ctx.services.artifacts.rename(input, ctx.caller, ctx.requestId),
    ),
  delete: mutation
    .input(ArtifactRefInputSchema)
    .output(Ok)
    .mutation(({ ctx, input }) =>
      ctx.services.artifacts.delete(input.id, ctx.caller, ctx.requestId),
    ),
  versions: procedure
    .input(ArtifactRefInputSchema)
    .output(z.array(VersionSummarySchema))
    .query(({ ctx, input }) => ctx.services.artifacts.versions(input.id)),
});

const versionsRouter = t.router({
  get: procedure
    .input(VersionRefInputSchema)
    .output(VersionViewSchema)
    .query(({ ctx, input }) => ctx.services.artifacts.version(input.id)),
  rotateToken: mutation
    .input(VersionRefInputSchema)
    .output(RotateTokenOutputSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.artifacts.rotateToken(input.id, ctx.caller, ctx.requestId),
    ),
});

const threadsRouter = t.router({
  list: procedure
    .input(ThreadListInputSchema)
    .output(z.array(ThreadViewSchema))
    .query(({ ctx, input }) => ctx.services.threads.list(input)),
  get: procedure
    .input(ThreadRefInputSchema)
    .output(ThreadViewSchema)
    .query(({ ctx, input }) => ctx.services.threads.get(input.threadId)),
  create: mutation
    .input(ThreadCreateInputSchema)
    .output(ThreadViewSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.threads.create(input, ctx.caller, ctx.requestId),
    ),
  reply: mutation
    .input(ThreadReplyInputSchema)
    .output(ThreadViewSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.threads.reply(input, ctx.caller, ctx.requestId),
    ),
  resolve: mutation
    .input(ThreadRefInputSchema)
    .output(ThreadViewSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.threads.resolve(input.threadId, ctx.caller, ctx.requestId),
    ),
  reopen: mutation
    .input(ThreadRefInputSchema)
    .output(ThreadViewSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.threads.reopen(input.threadId, ctx.caller, ctx.requestId),
    ),
  editComment: mutation
    .input(CommentEditInputSchema)
    .output(ThreadViewSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.threads.editComment(input, ctx.caller, ctx.requestId),
    ),
  deleteComment: mutation
    .input(CommentRefInputSchema)
    .output(ThreadViewSchema.nullable())
    .mutation(({ ctx, input }) =>
      ctx.services.threads.deleteComment(
        input.commentId,
        ctx.caller,
        ctx.requestId,
      ),
    ),
});

const feedbackRouter = t.router({
  claim: mutation
    .input(FeedbackClaimInputSchema)
    .output(FeedbackClaimResponseSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.feedback.claim(input, ctx.caller, ctx.requestId),
    ),
  ack: mutation
    .input(FeedbackAckInputSchema)
    .output(FeedbackAckOutputSchema)
    .mutation(({ ctx, input }) =>
      ctx.services.feedback.ack(input.commentIds, ctx.caller, ctx.requestId),
    ),
  pending: procedure
    .input(FeedbackPendingInputSchema)
    .output(FeedbackPendingOutputSchema)
    .query(({ ctx, input }) =>
      ctx.services.feedback.pending(input, ctx.caller),
    ),
  redeliver: mutation
    .input(FeedbackRedeliverInputSchema)
    .output(Ok)
    .mutation(({ ctx, input }) =>
      ctx.services.feedback.redeliver(
        input.commentId,
        ctx.caller,
        ctx.requestId,
      ),
    ),
  waiters: procedure
    .input(FeedbackWaitersInputSchema)
    .output(FeedbackWaitersOutputSchema)
    .query(({ ctx, input }) => ctx.services.waitersView.list(input)),
});

const inboxRouter = t.router({
  list: procedure
    .output(InboxListOutputSchema)
    .query(async ({ ctx }) => ({ boards: await ctx.services.inbox.list() })),
});

/** Internal host only: called by the hourly Temporal schedule. */
const maintenanceRouter = t.router({
  cleanup: internalProcedure
    .output(MaintenanceCleanupOutputSchema)
    .mutation(({ ctx }) => ctx.services.maintenance.cleanup()),
});

export const appRouter = t.router({
  boards: boardsRouter,
  artifacts: artifactsRouter,
  versions: versionsRouter,
  threads: threadsRouter,
  feedback: feedbackRouter,
  inbox: inboxRouter,
  maintenance: maintenanceRouter,
});
export type AppRouter = typeof appRouter;
