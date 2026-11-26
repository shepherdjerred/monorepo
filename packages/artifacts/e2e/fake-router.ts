/**
 * The tRPC router of the fake service. Same procedure names, input schemas and
 * output schemas as `src/server/router.ts`, so `createTRPCClient<AppRouter>`
 * type-checks against the real router and talks to this one.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  BoardIndexSchema,
  FeedbackClaimResponseSchema,
} from "#shared/contract.ts";
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
import { procedure, t } from "./fake-trpc.ts";
import {
  applyOps,
  artifactsOf,
  boardMatchesState,
  assertFramesOnBoard,
  boardBySlug,
  bumpActivity,
  commitIndex,
  createBoard,
  deleteArtifact,
  detailArtifact,
  documentOf,
  requireArtifact,
  requireBoard,
  requireVersion,
  summarizeArtifact,
  summarizeBoard,
  summarizeVersion,
} from "./fake-boards.ts";
import { emitChange } from "./fake-hub.ts";
import {
  ackFeedback,
  claimFeedback,
  createThread,
  defaultScope,
  deleteComment,
  editComment,
  inboxList,
  pendingFeedback,
  redeliver,
  replyToThread,
  requireThread,
  setThreadState,
  viewThread,
} from "./fake-threads.ts";
import {
  contentUrlOf,
  currentActor,
  currentScope,
  iso,
  newToken,
  type Store,
  type Waiter,
} from "./fake-types.ts";

const Ok = z.strictObject({ ok: z.literal(true) });

function waiterMatches(
  waiter: Waiter,
  input: z.infer<typeof FeedbackWaitersInputSchema>,
): boolean {
  const { scope } = waiter;
  const boardMatches =
    input.board === undefined ||
    (scope.type === "board" && scope.board === input.board);
  const artifactMatches =
    input.artifactId === undefined ||
    (scope.type === "artifact" && scope.artifactId === input.artifactId);
  return boardMatches && artifactMatches;
}

export function createFakeRouter(store: Store) {
  const boards = t.router({
    list: procedure
      .input(BoardListInputSchema)
      .output(z.array(BoardSummarySchema))
      .query(({ input }) =>
        [...store.boards.values()]
          .filter((board) => boardMatchesState(board, input.state))
          .toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)
          .slice(0, input.limit)
          .map((board) => summarizeBoard(store, board)),
      ),
    get: procedure
      .input(BoardRefInputSchema)
      .output(
        z.strictObject({
          board: BoardSummarySchema,
          index: BoardIndexSchema,
          artifacts: z.array(ArtifactSummarySchema),
        }),
      )
      .query(({ input }) => {
        const board = requireBoard(store, input.slug);
        return {
          board: summarizeBoard(store, board),
          index: structuredClone(board.index),
          artifacts: artifactsOf(store, board).map((artifact) =>
            summarizeArtifact(store, artifact),
          ),
        };
      }),
    create: procedure
      .input(BoardCreateInputSchema)
      .output(BoardSummarySchema)
      .mutation(({ input }) => {
        if (boardBySlug(store, input.slug) !== undefined)
          throw new TRPCError({
            code: "CONFLICT",
            message: `board ${input.slug} exists`,
          });
        return summarizeBoard(
          store,
          createBoard(store, input.slug, input.title),
        );
      }),
    update: procedure
      .input(BoardUpdateInputSchema)
      .output(BoardSummarySchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        board.title = input.title;
        bumpActivity(store, board);
        emitChange(store, board.id, "board.updated", board.id);
        return summarizeBoard(store, board);
      }),
    archive: procedure
      .input(BoardArchiveInputSchema)
      .output(BoardSummarySchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        board.archivedAt = input.archived ? store.options.now() : null;
        emitChange(store, board.id, "board.updated", board.id);
        return summarizeBoard(store, board);
      }),
    setKeep: procedure
      .input(BoardKeepInputSchema)
      .output(BoardSummarySchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        board.keep = input.keep;
        emitChange(store, board.id, "board.updated", board.id);
        return summarizeBoard(store, board);
      }),
    touch: procedure
      .input(BoardRefInputSchema)
      .output(Ok)
      .mutation(({ input }) => {
        bumpActivity(store, requireBoard(store, input.slug));
        return { ok: true as const };
      }),
    // tRPC reserves `apply`, so the contract's boards.apply is named applyOps here.
    applyOps: procedure
      .input(BoardApplyOpsInputSchema)
      .output(BoardDocumentSchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        applyOps(store, board, input.ops);
        return documentOf(board);
      }),
    replace: procedure
      .input(BoardReplaceInputSchema)
      .output(BoardDocumentSchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        if (input.expectedRevision !== board.revision) {
          currentScope().conflicts.set("boards.replace", documentOf(board));
          throw new TRPCError({
            code: "CONFLICT",
            message: `board is at revision ${String(board.revision)}`,
          });
        }
        assertFramesOnBoard(store, board, input.index);
        commitIndex(store, board, structuredClone(input.index));
        return documentOf(board);
      }),
  });

  const artifacts = t.router({
    list: procedure
      .input(ArtifactListInputSchema)
      .output(z.array(ArtifactSummarySchema))
      .query(({ input }) => {
        const board =
          input.board === undefined
            ? undefined
            : boardBySlug(store, input.board);
        return [...store.artifacts.values()]
          .filter(
            (artifact) =>
              (input.board === undefined || artifact.boardId === board?.id) &&
              (input.ownerKey === undefined ||
                artifact.ownerKey === input.ownerKey),
          )
          .toSorted((a, b) => b.createdAt - a.createdAt)
          .slice(0, input.limit)
          .map((artifact) => summarizeArtifact(store, artifact));
      }),
    get: procedure
      .input(ArtifactRefInputSchema)
      .output(ArtifactDetailSchema)
      .query(({ input }) =>
        detailArtifact(store, requireArtifact(store, input.id)),
      ),
    rename: procedure
      .input(ArtifactRenameInputSchema)
      .output(ArtifactSummarySchema)
      .mutation(({ input }) => {
        const artifact = requireArtifact(store, input.id);
        artifact.title = input.title;
        emitChange(store, artifact.boardId, "artifact.updated", artifact.id);
        return summarizeArtifact(store, artifact);
      }),
    delete: procedure
      .input(ArtifactRefInputSchema)
      .output(Ok)
      .mutation(({ input }) => {
        deleteArtifact(store, requireArtifact(store, input.id));
        return { ok: true as const };
      }),
    versions: procedure
      .input(ArtifactRefInputSchema)
      .output(z.array(VersionSummarySchema))
      .query(({ input }) =>
        requireArtifact(store, input.id)
          .versionIds.map((id) => summarizeVersion(requireVersion(store, id)))
          .toReversed(),
      ),
  });

  const versions = t.router({
    get: procedure
      .input(VersionRefInputSchema)
      .output(VersionViewSchema)
      .query(({ input }) => {
        const version = requireVersion(store, input.id);
        return {
          ...summarizeVersion(version),
          contentUrl: contentUrlOf(store, version),
          files: version.files.map((file) => ({ ...file })),
        };
      }),
    rotateToken: procedure
      .input(VersionRefInputSchema)
      .output(RotateTokenOutputSchema)
      .mutation(({ input }) => {
        const version = requireVersion(store, input.id);
        store.tokens.delete(version.token);
        version.token = newToken();
        store.tokens.set(version.token, version.id);
        return { contentUrl: contentUrlOf(store, version) };
      }),
  });

  const threads = t.router({
    list: procedure
      .input(ThreadListInputSchema)
      .output(z.array(ThreadViewSchema))
      .query(({ input }) => {
        const board =
          input.board === undefined
            ? undefined
            : boardBySlug(store, input.board);
        return [...store.threads.values()]
          .filter(
            (thread) =>
              (input.board === undefined || thread.boardId === board?.id) &&
              (input.artifactId === undefined ||
                thread.artifactId === input.artifactId) &&
              (input.state === undefined || thread.state === input.state),
          )
          .toSorted((a, b) => a.createdAt - b.createdAt)
          .map((thread) => viewThread(store, thread));
      }),
    get: procedure
      .input(ThreadRefInputSchema)
      .output(ThreadViewSchema)
      .query(({ input }) =>
        viewThread(store, requireThread(store, input.threadId)),
      ),
    create: procedure
      .input(ThreadCreateInputSchema)
      .output(ThreadViewSchema)
      .mutation(({ input }) => createThread(store, currentActor(), input)),
    reply: procedure
      .input(ThreadReplyInputSchema)
      .output(ThreadViewSchema)
      .mutation(({ input }) => replyToThread(store, currentActor(), input)),
    resolve: procedure
      .input(ThreadRefInputSchema)
      .output(ThreadViewSchema)
      .mutation(({ input }) => {
        const thread = requireThread(store, input.threadId);
        setThreadState(store, currentActor(), thread, "resolved");
        return viewThread(store, thread);
      }),
    reopen: procedure
      .input(ThreadRefInputSchema)
      .output(ThreadViewSchema)
      .mutation(({ input }) => {
        const thread = requireThread(store, input.threadId);
        setThreadState(store, currentActor(), thread, "open");
        return viewThread(store, thread);
      }),
    editComment: procedure
      .input(CommentEditInputSchema)
      .output(ThreadViewSchema)
      .mutation(({ input }) => editComment(store, currentActor(), input)),
    deleteComment: procedure
      .input(CommentRefInputSchema)
      .output(ThreadViewSchema.nullable())
      .mutation(({ input }) =>
        deleteComment(store, currentActor(), input.commentId),
      ),
  });

  const feedback = t.router({
    claim: procedure
      .input(FeedbackClaimInputSchema)
      .output(FeedbackClaimResponseSchema)
      .mutation(({ input }) => {
        const actor = currentActor();
        return claimFeedback(store, actor, input.scope ?? defaultScope(actor));
      }),
    ack: procedure
      .input(FeedbackAckInputSchema)
      .output(FeedbackAckOutputSchema)
      .mutation(({ input }) => ({
        acked: ackFeedback(store, currentActor(), input.commentIds),
      })),
    pending: procedure
      .input(FeedbackPendingInputSchema)
      .output(FeedbackPendingOutputSchema)
      .query(({ input }) => {
        const actor = currentActor();
        return pendingFeedback(
          store,
          actor,
          input.scope ?? defaultScope(actor),
        );
      }),
    redeliver: procedure
      .input(FeedbackRedeliverInputSchema)
      .output(Ok)
      .mutation(({ input }) => {
        redeliver(store, input.commentId);
        return { ok: true as const };
      }),
    waiters: procedure
      .input(FeedbackWaitersInputSchema)
      .output(FeedbackWaitersOutputSchema)
      .query(({ input }) => ({
        waiters: [...store.waiters]
          .filter((waiter) => waiterMatches(waiter, input))
          .map((waiter) => ({
            actor: waiter.actor,
            scope: waiter.scope,
            since: iso(waiter.since),
          })),
      })),
  });

  const inbox = t.router({
    list: procedure.output(InboxListOutputSchema).query(() => inboxList(store)),
  });

  const maintenance = t.router({
    cleanup: procedure
      .output(MaintenanceCleanupOutputSchema)
      .mutation(({ ctx }) => {
        if (ctx.hostClass !== "internal")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "internal host only",
          });
        return {
          status: "ok" as const,
          expiredSessions: 0,
          purgedBoards: 0,
          deletedBlobs: 0,
          deletedOrphans: 0,
          prunedEvents: 0,
          more: false,
        };
      }),
  });

  return t.router({
    boards,
    artifacts,
    versions,
    threads,
    feedback,
    inbox,
    maintenance,
  });
}

export type FakeRouter = ReturnType<typeof createFakeRouter>;
