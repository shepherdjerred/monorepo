import {
  BoardIndexSchema,
  FeedbackClaimResponseSchema,
} from "#shared/contract.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ArtifactDetailSchema,
  ArtifactListInputSchema,
  ArtifactRefInputSchema,
  ArtifactRenameInputSchema,
  ArtifactSummarySchema,
  BoardApplyInputSchema,
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
import { procedure, t } from "./rpc.ts";

function notImplemented(): never {
  throw new TRPCError({ code: "NOT_IMPLEMENTED" });
}

const boardsRouter = t.router({
  list: procedure
    .input(BoardListInputSchema)
    .output(z.array(BoardSummarySchema))
    .query(notImplemented),
  get: procedure
    .input(BoardRefInputSchema)
    .output(
      z.strictObject({
        board: BoardSummarySchema,
        index: BoardIndexSchema,
        artifacts: z.array(ArtifactSummarySchema),
      }),
    )
    .query(notImplemented),
  create: procedure
    .input(BoardCreateInputSchema)
    .output(BoardSummarySchema)
    .mutation(notImplemented),
  update: procedure
    .input(BoardUpdateInputSchema)
    .output(BoardSummarySchema)
    .mutation(notImplemented),
  archive: procedure
    .input(BoardArchiveInputSchema)
    .output(BoardSummarySchema)
    .mutation(notImplemented),
  setKeep: procedure
    .input(BoardKeepInputSchema)
    .output(BoardSummarySchema)
    .mutation(notImplemented),
  touch: procedure
    .input(BoardRefInputSchema)
    .output(z.strictObject({ ok: z.literal(true) }))
    .mutation(notImplemented),
  apply: procedure
    .input(BoardApplyInputSchema)
    .output(BoardDocumentSchema)
    .mutation(notImplemented),
  replace: procedure
    .input(BoardReplaceInputSchema)
    .output(BoardDocumentSchema)
    .mutation(notImplemented),
});

const artifactsRouter = t.router({
  list: procedure
    .input(ArtifactListInputSchema)
    .output(z.array(ArtifactSummarySchema))
    .query(notImplemented),
  get: procedure
    .input(ArtifactRefInputSchema)
    .output(ArtifactDetailSchema)
    .query(notImplemented),
  rename: procedure
    .input(ArtifactRenameInputSchema)
    .output(ArtifactSummarySchema)
    .mutation(notImplemented),
  delete: procedure
    .input(ArtifactRefInputSchema)
    .output(z.strictObject({ ok: z.literal(true) }))
    .mutation(notImplemented),
  versions: procedure
    .input(ArtifactRefInputSchema)
    .output(z.array(VersionSummarySchema))
    .query(notImplemented),
});

const versionsRouter = t.router({
  get: procedure
    .input(VersionRefInputSchema)
    .output(VersionViewSchema)
    .query(notImplemented),
  rotateToken: procedure
    .input(VersionRefInputSchema)
    .output(RotateTokenOutputSchema)
    .mutation(notImplemented),
});

const threadsRouter = t.router({
  list: procedure
    .input(ThreadListInputSchema)
    .output(z.array(ThreadViewSchema))
    .query(notImplemented),
  get: procedure
    .input(ThreadRefInputSchema)
    .output(ThreadViewSchema)
    .query(notImplemented),
  create: procedure
    .input(ThreadCreateInputSchema)
    .output(ThreadViewSchema)
    .mutation(notImplemented),
  reply: procedure
    .input(ThreadReplyInputSchema)
    .output(ThreadViewSchema)
    .mutation(notImplemented),
  resolve: procedure
    .input(ThreadRefInputSchema)
    .output(ThreadViewSchema)
    .mutation(notImplemented),
  reopen: procedure
    .input(ThreadRefInputSchema)
    .output(ThreadViewSchema)
    .mutation(notImplemented),
  editComment: procedure
    .input(CommentEditInputSchema)
    .output(ThreadViewSchema)
    .mutation(notImplemented),
  deleteComment: procedure
    .input(CommentRefInputSchema)
    .output(ThreadViewSchema.nullable())
    .mutation(notImplemented),
});

const feedbackRouter = t.router({
  claim: procedure
    .input(FeedbackClaimInputSchema)
    .output(FeedbackClaimResponseSchema)
    .mutation(notImplemented),
  ack: procedure
    .input(FeedbackAckInputSchema)
    .output(FeedbackAckOutputSchema)
    .mutation(notImplemented),
  pending: procedure
    .input(FeedbackPendingInputSchema)
    .output(FeedbackPendingOutputSchema)
    .query(notImplemented),
  redeliver: procedure
    .input(FeedbackRedeliverInputSchema)
    .output(z.strictObject({ ok: z.literal(true) }))
    .mutation(notImplemented),
  waiters: procedure
    .input(FeedbackWaitersInputSchema)
    .output(FeedbackWaitersOutputSchema)
    .query(notImplemented),
});

const inboxRouter = t.router({
  list: procedure.output(InboxListOutputSchema).query(notImplemented),
});

/** Internal host only: called by the hourly Temporal schedule. */
const maintenanceRouter = t.router({
  cleanup: procedure
    .output(MaintenanceCleanupOutputSchema)
    .mutation(notImplemented),
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
