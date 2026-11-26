import type { InboxBoard } from "#shared/procedures.ts";
import { boardStats, presentBoard } from "./views.ts";
import type { Deps } from "./types.ts";

type CountRow = { boardId: string; n: number };

export function createInbox(deps: Deps) {
  const { db } = deps;
  return {
    /**
     * Every board with what the inbox groups on. `needsReviewCount` counts
     * artifacts whose current version no human has commented on since it was
     * published; `unhandledCount` counts open threads holding a human comment
     * no agent has handled.
     */
    async list(): Promise<InboxBoard[]> {
      const boards = await db.board.findMany({
        orderBy: { lastActivityAt: "desc" },
        take: 500,
      });
      const ids = boards.map((board) => board.id);
      const [stats, needsReview, open, unhandled] = await Promise.all([
        boardStats(db, ids),
        db.$queryRaw<CountRow[]>`
          SELECT a."boardId" AS "boardId", COUNT(*)::int AS "n"
          FROM "Artifact" a JOIN "Version" v ON v."id" = a."currentVersionId"
          WHERE a."deletedAt" IS NULL AND a."boardId" = ANY(${ids}::text[])
            AND NOT EXISTS (
              SELECT 1 FROM "Thread" t
              JOIN "Comment" c ON c."threadId" = t."id" AND c."createdAt" >= v."createdAt"
              JOIN "Actor" h ON h."id" = c."authorId" AND h."kind" = 'human'
              WHERE t."artifactId" = a."id")
          GROUP BY a."boardId"`,
        db.$queryRaw<CountRow[]>`
          SELECT "boardId", COUNT(*)::int AS "n" FROM "Thread"
          WHERE "state" = 'open' AND "boardId" = ANY(${ids}::text[])
          GROUP BY "boardId"`,
        db.$queryRaw<CountRow[]>`
          SELECT t."boardId" AS "boardId", COUNT(DISTINCT t."id")::int AS "n"
          FROM "Thread" t
          JOIN "Comment" c ON c."threadId" = t."id"
          JOIN "Actor" h ON h."id" = c."authorId" AND h."kind" = 'human'
          LEFT JOIN "Delivery" d ON d."commentId" = c."id"
          WHERE t."state" = 'open' AND t."boardId" = ANY(${ids}::text[])
            AND (d."commentId" IS NULL OR d."handledAt" IS NULL)
          GROUP BY t."boardId"`,
      ]);
      const count = (rows: CountRow[]) =>
        new Map(rows.map((row) => [row.boardId, row.n]));
      const [reviewOf, openOf, unhandledOf] = [
        count(needsReview),
        count(open),
        count(unhandled),
      ];
      return Promise.all(
        boards.map(async (board): Promise<InboxBoard> => ({
          ...(await presentBoard(deps, board, stats.get(board.id))),
          needsReviewCount: reviewOf.get(board.id) ?? 0,
          openThreadCount: openOf.get(board.id) ?? 0,
          unhandledCount: unhandledOf.get(board.id) ?? 0,
        })),
      );
    },
  };
}
