import { type Anchor } from "#shared/contract.ts";
import type { ThreadView } from "#shared/procedures.ts";
import { deliverableAt } from "#domain/claim.ts";
import { transact, type Tx } from "#infrastructure/database.ts";
import { ArtifactsError } from "./errors.ts";
import { recordEvents } from "./events.ts";
import { THREAD_INCLUDE, presentThread } from "./thread-view.ts";
import type { Audit, Caller, Deps } from "./types.ts";

const ARTIFACT_ANCHORS = new Set(["frame", "doc", "page", "time"]);

async function addComment(
  tx: Tx,
  thread: { id: string; boardId: string; artifactId: string | null },
  input: { body: string; settle: number; now: Date },
  audit: Audit,
) {
  const comment = await tx.comment.create({
    data: {
      threadId: thread.id,
      authorId: audit.actor.id,
      body: input.body,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  await recordEvents(tx, [
    {
      boardId: thread.boardId,
      kind: "comment.created",
      entityId: comment.id,
      actorId: audit.actor.id,
      requestId: audit.requestId,
      payload: {
        threadId: thread.id,
        artifactId: thread.artifactId,
        commentId: comment.id,
        human: audit.actor.kind === "human",
        deliverableAt: deliverableAt(
          comment.updatedAt,
          input.settle,
        ).toISOString(),
      },
    },
  ]);
  return comment;
}

/**
 * An agent's reply or resolution marks the comments it was handed on this
 * thread as handled, in the reply's own transaction. Comments no agent has
 * claimed have no delivery row and stay deliverable.
 */
async function markHandled(
  tx: Tx,
  thread: { id: string; boardId: string; now: Date },
  audit: Audit,
) {
  if (audit.actor.kind === "human") return;
  const handled = await tx.delivery.updateManyAndReturn({
    where: { handledAt: null, comment: { threadId: thread.id } },
    data: { handledAt: thread.now },
    select: { commentId: true },
  });
  await recordEvents(
    tx,
    handled.map((row) => ({
      boardId: thread.boardId,
      kind: "delivery.handled",
      entityId: row.commentId,
      actorId: audit.actor.id,
      requestId: audit.requestId,
    })),
  );
}

async function lockThread(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Thread" WHERE "id" = ${id} FOR UPDATE`;
  const thread = await tx.thread.findUnique({ where: { id } });
  if (thread === null)
    throw new ArtifactsError("NOT_FOUND", "Thread not found");
  return thread;
}

export function createThreads(deps: Deps) {
  const { db } = deps;

  async function assertWritable() {
    if (!(await deps.settings.value("artifactsEnabled")))
      throw new ArtifactsError("FORBIDDEN", "Artifacts is paused");
  }

  async function present(id: string): Promise<ThreadView> {
    const [row, settle] = await Promise.all([
      db.thread.findUnique({ where: { id }, include: THREAD_INCLUDE }),
      deps.settings.value("feedbackSettleSeconds"),
    ]);
    if (row === null) throw new ArtifactsError("NOT_FOUND", "Thread not found");
    return presentThread(row, settle, deps.now());
  }

  /** Validates where a new thread points and returns the ids to store. */
  async function resolveTarget(
    input: {
      board: string;
      artifactId?: string | undefined;
      versionId?: string | undefined;
    },
    anchor: Anchor,
  ) {
    const board = await db.board.findUnique({ where: { slug: input.board } });
    if (board === null)
      throw new ArtifactsError("NOT_FOUND", "Board not found");
    if (anchor.type === "board" && input.artifactId !== undefined)
      throw new ArtifactsError(
        "BAD_REQUEST",
        "A board anchor cannot name an artifact",
      );
    if (ARTIFACT_ANCHORS.has(anchor.type) && input.artifactId === undefined)
      throw new ArtifactsError(
        "BAD_REQUEST",
        `A ${anchor.type} anchor needs an artifactId`,
      );
    if (input.artifactId === undefined)
      return { boardId: board.id, artifactId: null, versionId: null };
    if (input.versionId === undefined)
      throw new ArtifactsError(
        "BAD_REQUEST",
        "An artifact thread needs a versionId",
      );
    const version = await db.version.findFirst({
      where: {
        id: input.versionId,
        artifactId: input.artifactId,
        artifact: { boardId: board.id, deletedAt: null },
      },
    });
    if (version === null)
      throw new ArtifactsError(
        "NOT_FOUND",
        "Version not found on that artifact",
      );
    return {
      boardId: board.id,
      artifactId: input.artifactId,
      versionId: version.id,
    };
  }

  async function setState(
    threadId: string,
    state: "open" | "resolved",
    actor: Caller,
    requestId: string,
  ) {
    await assertWritable();
    await transact(db, async (tx) => {
      const thread = await lockThread(tx, threadId);
      if (thread.state === state) return;
      await tx.thread.update({
        where: { id: threadId },
        data: { state, resolvedAt: state === "resolved" ? deps.now() : null },
      });
      if (state === "resolved")
        await markHandled(
          tx,
          { id: threadId, boardId: thread.boardId, now: deps.now() },
          { actor, requestId },
        );
      await recordEvents(tx, [
        {
          boardId: thread.boardId,
          kind: state === "resolved" ? "thread.resolved" : "thread.reopened",
          entityId: threadId,
          actorId: actor.id,
          requestId,
          payload: { threadId, artifactId: thread.artifactId },
        },
      ]);
    });
    return present(threadId);
  }

  async function lockEditable(
    tx: Tx,
    commentId: string,
    actor: Caller,
    settle: number,
  ) {
    await tx.$queryRaw`SELECT "id" FROM "Comment" WHERE "id" = ${commentId} FOR UPDATE`;
    const comment = await tx.comment.findUnique({
      where: { id: commentId },
      include: { author: true, delivery: true, thread: true },
    });
    if (comment === null)
      throw new ArtifactsError("NOT_FOUND", "Comment not found");
    if (comment.authorId !== actor.id || comment.author.kind !== "human")
      throw new ArtifactsError(
        "FORBIDDEN",
        "Only a human author can change their comment",
      );
    if (comment.delivery !== null)
      throw new ArtifactsError(
        "FORBIDDEN",
        "The comment was already delivered to an agent",
      );
    if (deliverableAt(comment.updatedAt, settle) <= deps.now())
      throw new ArtifactsError(
        "FORBIDDEN",
        "The comment can no longer be changed",
      );
    return comment;
  }

  return {
    async list(input: {
      board?: string | undefined;
      artifactId?: string | undefined;
      state?: "open" | "resolved" | undefined;
    }): Promise<ThreadView[]> {
      const [rows, settle] = await Promise.all([
        db.thread.findMany({
          where: {
            ...(input.board === undefined
              ? {}
              : { board: { slug: input.board } }),
            ...(input.artifactId === undefined
              ? {}
              : { artifactId: input.artifactId }),
            ...(input.state === undefined ? {} : { state: input.state }),
          },
          include: THREAD_INCLUDE,
          orderBy: { createdAt: "asc" },
          take: 1000,
        }),
        deps.settings.value("feedbackSettleSeconds"),
      ]);
      const now = deps.now();
      return rows.map((row) => presentThread(row, settle, now));
    },

    get: present,

    async create(
      input: {
        board: string;
        artifactId?: string | undefined;
        versionId?: string | undefined;
        anchor: Anchor;
        body: string;
      },
      actor: Caller,
      requestId: string,
    ): Promise<ThreadView> {
      await assertWritable();
      const target = await resolveTarget(input, input.anchor);
      const settle = await deps.settings.value("feedbackSettleSeconds");
      const id = await transact(db, async (tx) => {
        const thread = await tx.thread.create({
          data: { ...target, anchor: input.anchor, createdById: actor.id },
        });
        await addComment(
          tx,
          thread,
          { body: input.body, settle, now: deps.now() },
          { actor, requestId },
        );
        await tx.board.update({
          where: { id: target.boardId },
          data: { lastActivityAt: deps.now() },
        });
        await recordEvents(tx, [
          {
            boardId: target.boardId,
            kind: "thread.created",
            entityId: thread.id,
            actorId: actor.id,
            requestId,
            payload: { threadId: thread.id, artifactId: target.artifactId },
          },
        ]);
        return thread.id;
      });
      return present(id);
    },

    async reply(
      input: { threadId: string; body: string; resolve: boolean },
      actor: Caller,
      requestId: string,
    ): Promise<ThreadView> {
      await assertWritable();
      const settle = await deps.settings.value("feedbackSettleSeconds");
      await transact(db, async (tx) => {
        const thread = await lockThread(tx, input.threadId);
        await addComment(
          tx,
          thread,
          { body: input.body, settle, now: deps.now() },
          { actor, requestId },
        );
        await markHandled(
          tx,
          { id: thread.id, boardId: thread.boardId, now: deps.now() },
          { actor, requestId },
        );
        // A human replying to a resolved thread reopens it; an agent may resolve.
        const state = input.resolve
          ? "resolved"
          : actor.kind === "human"
            ? "open"
            : thread.state;
        if (state !== thread.state)
          await tx.thread.update({
            where: { id: thread.id },
            data: {
              state,
              resolvedAt: state === "resolved" ? deps.now() : null,
            },
          });
        await tx.board.update({
          where: { id: thread.boardId },
          data: { lastActivityAt: deps.now() },
        });
        await recordEvents(tx, [
          {
            boardId: thread.boardId,
            kind:
              state === thread.state
                ? "thread.replied"
                : state === "resolved"
                  ? "thread.resolved"
                  : "thread.reopened",
            entityId: thread.id,
            actorId: actor.id,
            requestId,
            payload: { threadId: thread.id, artifactId: thread.artifactId },
          },
        ]);
      });
      return present(input.threadId);
    },

    resolve: (threadId: string, actor: Caller, requestId: string) =>
      setState(threadId, "resolved", actor, requestId),
    reopen: (threadId: string, actor: Caller, requestId: string) =>
      setState(threadId, "open", actor, requestId),

    async editComment(
      input: { commentId: string; body: string },
      actor: Caller,
      requestId: string,
    ): Promise<ThreadView> {
      await assertWritable();
      const settle = await deps.settings.value("feedbackSettleSeconds");
      const threadId = await transact(db, async (tx) => {
        const comment = await lockEditable(tx, input.commentId, actor, settle);
        const updated = await tx.comment.update({
          where: { id: comment.id },
          data: { body: input.body, updatedAt: deps.now() },
        });
        await recordEvents(tx, [
          {
            boardId: comment.thread.boardId,
            kind: "comment.updated",
            entityId: comment.id,
            actorId: actor.id,
            requestId,
            payload: {
              threadId: comment.threadId,
              artifactId: comment.thread.artifactId,
              commentId: comment.id,
              human: true,
              deliverableAt: deliverableAt(
                updated.updatedAt,
                settle,
              ).toISOString(),
            },
          },
        ]);
        return comment.threadId;
      });
      return present(threadId);
    },

    /** Deleting a thread's only comment deletes the thread; returns null then. */
    async deleteComment(
      commentId: string,
      actor: Caller,
      requestId: string,
    ): Promise<ThreadView | null> {
      await assertWritable();
      const settle = await deps.settings.value("feedbackSettleSeconds");
      const outcome = await transact(db, async (tx) => {
        const comment = await lockEditable(tx, commentId, actor, settle);
        await tx.comment.delete({ where: { id: commentId } });
        const remaining = await tx.comment.count({
          where: { threadId: comment.threadId },
        });
        if (remaining === 0)
          await tx.thread.delete({ where: { id: comment.threadId } });
        await recordEvents(tx, [
          {
            boardId: comment.thread.boardId,
            kind: "comment.deleted",
            entityId: commentId,
            actorId: actor.id,
            requestId,
            payload: {
              threadId: comment.threadId,
              artifactId: comment.thread.artifactId,
            },
          },
        ]);
        return remaining === 0 ? null : comment.threadId;
      });
      return outcome === null ? null : present(outcome);
    },
  };
}
export type Threads = ReturnType<typeof createThreads>;
