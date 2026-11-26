import {
  BoardIndexSchema,
  EMPTY_BOARD_INDEX,
  type BoardIndex,
  type BoardOp,
} from "#shared/contract.ts";
import type {
  ArtifactSummary,
  BoardDocument,
  BoardSummary,
} from "#shared/procedures.ts";
import { applyBoardOps } from "#domain/board-ops.ts";
import { transact, type Tx } from "#infrastructure/database.ts";
import { ArtifactsError } from "./errors.ts";
import { recordEvents } from "./events.ts";
import type { Audit, Caller, Deps } from "./types.ts";
import {
  ARTIFACT_INCLUDE,
  boardStats,
  openThreadCounts,
  presentArtifact,
  presentBoard,
} from "./views.ts";

const KEPT_REVISIONS = 50;

type LockedBoard = { id: string; index: unknown; revision: number };

/** Locks the board row for the rest of the transaction. */
async function lockBoardBySlug(tx: Tx, slug: string): Promise<LockedBoard> {
  const rows = await tx.$queryRaw<LockedBoard[]>`
    SELECT "id", "index", "revision" FROM "Board" WHERE "slug" = ${slug} FOR UPDATE`;
  const board = rows[0];
  if (board === undefined)
    throw new ArtifactsError("NOT_FOUND", "Board not found");
  return board;
}

export async function lockBoardById(tx: Tx, id: string): Promise<LockedBoard> {
  const rows = await tx.$queryRaw<LockedBoard[]>`
    SELECT "id", "index", "revision" FROM "Board" WHERE "id" = ${id} FOR UPDATE`;
  const board = rows[0];
  if (board === undefined)
    throw new ArtifactsError("NOT_FOUND", "Board not found");
  return board;
}

/**
 * Merges operations into a locked board's index. Never refused: operations
 * naming something gone are skipped. Bumps the revision only when the
 * document changed.
 */
export async function applyOpsLocked(
  tx: Tx,
  board: LockedBoard,
  ops: BoardOp[],
  audit: Audit,
): Promise<BoardDocument> {
  const current = BoardIndexSchema.parse(board.index);
  const next = applyBoardOps(current, ops);
  if (Bun.deepEquals(current, next))
    return { revision: board.revision, index: current };
  const revision = board.revision + 1;
  await tx.board.update({
    where: { id: board.id },
    data: { index: next, revision, lastActivityAt: new Date() },
  });
  await recordEvents(tx, [
    {
      boardId: board.id,
      kind: "board.changed",
      entityId: board.id,
      actorId: audit.actor.id,
      requestId: audit.requestId,
      payload: { revision },
    },
  ]);
  return { revision, index: next };
}

export function createBoards(deps: Deps) {
  const { db } = deps;

  async function bySlug(slug: string) {
    const board = await db.board.findUnique({ where: { slug } });
    if (board === null)
      throw new ArtifactsError("NOT_FOUND", "Board not found");
    return board;
  }

  async function summary(slug: string): Promise<BoardSummary> {
    const board = await bySlug(slug);
    const stats = await boardStats(db, [board.id]);
    return presentBoard(deps, board, stats.get(board.id));
  }

  async function mutateBoard(
    slug: string,
    kind: string,
    data: { title?: string; keep?: boolean; archivedAt?: Date | null },
    audit: Audit,
  ) {
    await transact(db, async (tx) => {
      const board = await lockBoardBySlug(tx, slug);
      await tx.board.update({
        where: { id: board.id },
        data: { ...data, lastActivityAt: deps.now() },
      });
      await recordEvents(tx, [
        {
          boardId: board.id,
          kind,
          entityId: board.id,
          actorId: audit.actor.id,
          requestId: audit.requestId,
        },
      ]);
    });
    return summary(slug);
  }

  return {
    async list(input: {
      state: "active" | "archived" | "kept" | "all";
      limit: number;
    }): Promise<BoardSummary[]> {
      const where =
        input.state === "active"
          ? { archivedAt: null }
          : input.state === "archived"
            ? { archivedAt: { not: null } }
            : input.state === "kept"
              ? { keep: true }
              : {};
      const boards = await db.board.findMany({
        where,
        orderBy: { lastActivityAt: "desc" },
        take: input.limit,
      });
      const stats = await boardStats(
        db,
        boards.map((board) => board.id),
      );
      return Promise.all(
        boards.map((board) => presentBoard(deps, board, stats.get(board.id))),
      );
    },

    async get(slug: string): Promise<{
      board: BoardSummary;
      index: BoardIndex;
      artifacts: ArtifactSummary[];
    }> {
      const board = await bySlug(slug);
      const [stats, artifacts] = await Promise.all([
        boardStats(db, [board.id]),
        db.artifact.findMany({
          where: { boardId: board.id, deletedAt: null },
          include: ARTIFACT_INCLUDE,
          orderBy: { createdAt: "asc" },
        }),
      ]);
      const threads = await openThreadCounts(
        db,
        artifacts.map((a) => a.id),
      );
      return {
        board: await presentBoard(deps, board, stats.get(board.id)),
        index: BoardIndexSchema.parse(board.index),
        artifacts: artifacts.map((artifact) =>
          presentArtifact(artifact, threads.get(artifact.id) ?? 0),
        ),
      };
    },

    async create(
      input: { slug: string; title: string },
      actor: Caller,
      requestId: string,
    ): Promise<BoardSummary> {
      const existing = await db.board.findUnique({
        where: { slug: input.slug },
      });
      if (existing !== null)
        throw new ArtifactsError("CONFLICT", "A board with that slug exists");
      await transact(db, async (tx) => {
        const board = await tx.board.create({
          data: {
            slug: input.slug,
            title: input.title,
            index: EMPTY_BOARD_INDEX,
          },
        });
        await recordEvents(tx, [
          {
            boardId: board.id,
            kind: "board.created",
            entityId: board.id,
            actorId: actor.id,
            requestId,
          },
        ]);
      });
      return summary(input.slug);
    },

    update: (
      input: { slug: string; title: string },
      actor: Caller,
      requestId: string,
    ) =>
      mutateBoard(
        input.slug,
        "board.updated",
        { title: input.title },
        { actor, requestId },
      ),

    archive: (
      input: { slug: string; archived: boolean },
      actor: Caller,
      requestId: string,
    ) =>
      mutateBoard(
        input.slug,
        input.archived ? "board.archived" : "board.unarchived",
        { archivedAt: input.archived ? deps.now() : null },
        { actor, requestId },
      ),

    setKeep: (
      input: { slug: string; keep: boolean },
      actor: Caller,
      requestId: string,
    ) =>
      mutateBoard(
        input.slug,
        "board.keep",
        { keep: input.keep },
        { actor, requestId },
      ),

    async touch(slug: string): Promise<{ ok: true }> {
      const result = await db.board.updateMany({
        where: { slug },
        data: { lastActivityAt: deps.now() },
      });
      if (result.count === 0)
        throw new ArtifactsError("NOT_FOUND", "Board not found");
      return { ok: true };
    },

    applyOps: (
      input: { slug: string; ops: BoardOp[] },
      actor: Caller,
      requestId: string,
    ): Promise<BoardDocument> =>
      transact(db, async (tx) => {
        const board = await lockBoardBySlug(tx, input.slug);
        return applyOpsLocked(tx, board, input.ops, { actor, requestId });
      }),

    /** Whole-document compare-and-set; a stale revision gets the current one back. */
    replace: (
      input: { slug: string; expectedRevision: number; index: BoardIndex },
      actor: Caller,
      requestId: string,
    ): Promise<BoardDocument> =>
      transact(db, async (tx) => {
        const board = await lockBoardBySlug(tx, input.slug);
        if (board.revision !== input.expectedRevision)
          throw new ArtifactsError("CONFLICT", "The board changed", {
            conflict: {
              revision: board.revision,
              index: BoardIndexSchema.parse(board.index),
            },
          });
        const revision = board.revision + 1;
        await tx.board.update({
          where: { id: board.id },
          data: { index: input.index, revision, lastActivityAt: deps.now() },
        });
        await tx.boardRevision.create({
          data: {
            boardId: board.id,
            revision,
            index: input.index,
            actorId: actor.id,
          },
        });
        await tx.boardRevision.deleteMany({
          where: {
            boardId: board.id,
            revision: { lte: revision - KEPT_REVISIONS },
          },
        });
        await recordEvents(tx, [
          {
            boardId: board.id,
            kind: "board.changed",
            entityId: board.id,
            actorId: actor.id,
            requestId,
            payload: { revision },
          },
        ]);
        return { revision, index: input.index };
      }),
  };
}
export type Boards = ReturnType<typeof createBoards>;
