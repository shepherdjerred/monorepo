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
import * as procedures from "#shared/procedures.ts";
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
  input: z.infer<typeof procedures.FeedbackWaitersInputSchema>,
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
      .input(procedures.BoardListInputSchema)
      .output(z.array(procedures.BoardSummarySchema))
      .query(({ input }) =>
        [...store.boards.values()]
          .filter((board) => boardMatchesState(board, input.state))
          .toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)
          .slice(0, input.limit)
          .map((board) => summarizeBoard(store, board)),
      ),
    get: procedure
      .input(procedures.BoardRefInputSchema)
      .output(
        z.strictObject({
          board: procedures.BoardSummarySchema,
          index: BoardIndexSchema,
          artifacts: z.array(procedures.ArtifactSummarySchema),
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
      .input(procedures.BoardCreateInputSchema)
      .output(procedures.BoardSummarySchema)
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
      .input(procedures.BoardUpdateInputSchema)
      .output(procedures.BoardSummarySchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        board.title = input.title;
        bumpActivity(store, board);
        emitChange(store, board.id, "board.updated", board.id);
        return summarizeBoard(store, board);
      }),
    archive: procedure
      .input(procedures.BoardArchiveInputSchema)
      .output(procedures.BoardSummarySchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        board.archivedAt = input.archived ? store.options.now() : null;
        emitChange(store, board.id, "board.updated", board.id);
        return summarizeBoard(store, board);
      }),
    setKeep: procedure
      .input(procedures.BoardKeepInputSchema)
      .output(procedures.BoardSummarySchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        board.keep = input.keep;
        emitChange(store, board.id, "board.updated", board.id);
        return summarizeBoard(store, board);
      }),
    touch: procedure
      .input(procedures.BoardRefInputSchema)
      .output(Ok)
      .mutation(({ input }) => {
        bumpActivity(store, requireBoard(store, input.slug));
        return { ok: true as const };
      }),
    // tRPC reserves `apply`, so the contract's boards.apply is named applyOps here.
    applyOps: procedure
      .input(procedures.BoardApplyOpsInputSchema)
      .output(procedures.BoardDocumentSchema)
      .mutation(({ input }) => {
        const board = requireBoard(store, input.slug);
        applyOps(store, board, input.ops);
        return documentOf(board);
      }),
    replace: procedure
      .input(procedures.BoardReplaceInputSchema)
      .output(procedures.BoardDocumentSchema)
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
      .input(procedures.ArtifactListInputSchema)
      .output(z.array(procedures.ArtifactSummarySchema))
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
      .input(procedures.ArtifactRefInputSchema)
      .output(procedures.ArtifactDetailSchema)
      .query(({ input }) =>
        detailArtifact(store, requireArtifact(store, input.id)),
      ),
    rename: procedure
      .input(procedures.ArtifactRenameInputSchema)
      .output(procedures.ArtifactSummarySchema)
      .mutation(({ input }) => {
        const artifact = requireArtifact(store, input.id);
        artifact.title = input.title;
        emitChange(store, artifact.boardId, "artifact.updated", artifact.id);
        return summarizeArtifact(store, artifact);
      }),
    delete: procedure
      .input(procedures.ArtifactRefInputSchema)
      .output(Ok)
      .mutation(({ input }) => {
        deleteArtifact(store, requireArtifact(store, input.id));
        return { ok: true as const };
      }),
    versions: procedure
      .input(procedures.ArtifactRefInputSchema)
      .output(z.array(procedures.VersionSummarySchema))
      .query(({ input }) =>
        requireArtifact(store, input.id)
          .versionIds.map((id) => summarizeVersion(requireVersion(store, id)))
          .toReversed(),
      ),
  });

  const versions = t.router({
    get: procedure
      .input(procedures.VersionRefInputSchema)
      .output(procedures.VersionViewSchema)
      .query(({ input }) => {
        const version = requireVersion(store, input.id);
        return {
          ...summarizeVersion(version),
          contentUrl: contentUrlOf(store, version),
          files: version.files.map((file) => ({ ...file })),
        };
      }),
    rotateToken: procedure
      .input(procedures.VersionRefInputSchema)
      .output(procedures.RotateTokenOutputSchema)
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
      .input(procedures.ThreadListInputSchema)
      .output(z.array(procedures.ThreadViewSchema))
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
      .input(procedures.ThreadRefInputSchema)
      .output(procedures.ThreadViewSchema)
      .query(({ input }) =>
        viewThread(store, requireThread(store, input.threadId)),
      ),
    create: procedure
      .input(procedures.ThreadCreateInputSchema)
      .output(procedures.ThreadViewSchema)
      .mutation(({ input }) => createThread(store, currentActor(), input)),
    reply: procedure
      .input(procedures.ThreadReplyInputSchema)
      .output(procedures.ThreadViewSchema)
      .mutation(({ input }) => replyToThread(store, currentActor(), input)),
    resolve: procedure
      .input(procedures.ThreadRefInputSchema)
      .output(procedures.ThreadViewSchema)
      .mutation(({ input }) => {
        const thread = requireThread(store, input.threadId);
        setThreadState(store, currentActor(), thread, "resolved");
        return viewThread(store, thread);
      }),
    reopen: procedure
      .input(procedures.ThreadRefInputSchema)
      .output(procedures.ThreadViewSchema)
      .mutation(({ input }) => {
        const thread = requireThread(store, input.threadId);
        setThreadState(store, currentActor(), thread, "open");
        return viewThread(store, thread);
      }),
    editComment: procedure
      .input(procedures.CommentEditInputSchema)
      .output(procedures.ThreadViewSchema)
      .mutation(({ input }) => editComment(store, currentActor(), input)),
    deleteComment: procedure
      .input(procedures.CommentRefInputSchema)
      .output(procedures.ThreadViewSchema.nullable())
      .mutation(({ input }) =>
        deleteComment(store, currentActor(), input.commentId),
      ),
  });

  const feedback = t.router({
    claim: procedure
      .input(procedures.FeedbackClaimInputSchema)
      .output(FeedbackClaimResponseSchema)
      .mutation(({ input }) => {
        const actor = currentActor();
        return claimFeedback(store, actor, input.scope ?? defaultScope(actor));
      }),
    ack: procedure
      .input(procedures.FeedbackAckInputSchema)
      .output(procedures.FeedbackAckOutputSchema)
      .mutation(({ input }) => ({
        acked: ackFeedback(store, currentActor(), input.commentIds),
      })),
    pending: procedure
      .input(procedures.FeedbackPendingInputSchema)
      .output(procedures.FeedbackPendingOutputSchema)
      .query(({ input }) => {
        const actor = currentActor();
        return pendingFeedback(
          store,
          actor,
          input.scope ?? defaultScope(actor),
        );
      }),
    redeliver: procedure
      .input(procedures.FeedbackRedeliverInputSchema)
      .output(Ok)
      .mutation(({ input }) => {
        redeliver(store, input.commentId);
        return { ok: true as const };
      }),
    waiters: procedure
      .input(procedures.FeedbackWaitersInputSchema)
      .output(procedures.FeedbackWaitersOutputSchema)
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
    list: procedure
      .output(procedures.InboxListOutputSchema)
      .query(() => inboxList(store)),
  });

  const maintenance = t.router({
    cleanup: procedure
      .output(procedures.MaintenanceCleanupOutputSchema)
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
