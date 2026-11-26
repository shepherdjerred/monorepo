import { Prisma } from "#generated/prisma/client.ts";
import {
  AnchorSchema,
  type FeedbackClaimResponse,
  type FeedbackItem,
  type FeedbackScope,
} from "#shared/contract.ts";
import { claimDecision, deliverableAt } from "#domain/claim.ts";
import { transact, type Tx } from "#infrastructure/database.ts";
import { ArtifactsError } from "./errors.ts";
import { recordEvents } from "./events.ts";
import type { Caller, Deps } from "./types.ts";
import { iso } from "./views.ts";

const MINUTE_MS = 60_000;
const CLAIM_BATCH = 100;

/** A settled human comment on an open thread that no agent has handled. */
type Candidate = {
  commentId: string;
  updatedAt: Date;
};

type DeliveryRow = {
  commentId: string;
  actorId: string;
  ackedAt: Date | null;
  actorLastSeenAt: Date;
};

/** The scope as SQL; every branch also excludes deleted artifacts. */
export function scopeSql(scope: FeedbackScope): Prisma.Sql {
  switch (scope.type) {
    case "owner":
      return Prisma.sql`(
        a."ownerKey" = ${scope.ownerKey}
        OR (t."artifactId" IS NULL AND t."boardId" IN (
          SELECT "boardId" FROM "Artifact"
          WHERE "ownerKey" = ${scope.ownerKey} AND "deletedAt" IS NULL)))`;
    case "board":
      return Prisma.sql`t."boardId" = (SELECT "id" FROM "Board" WHERE "slug" = ${scope.board})`;
    case "artifact":
      return Prisma.sql`t."artifactId" = ${scope.artifactId}`;
  }
}

/** Comments in scope that are human, unhandled, on an open thread. */
async function candidates(
  tx: Pick<Tx, "$queryRaw">,
  scope: FeedbackScope,
  settledBefore: Date | null,
  lock: boolean,
): Promise<Candidate[]> {
  const settled =
    settledBefore === null
      ? Prisma.empty
      : Prisma.sql`AND c."updatedAt" <= ${settledBefore}`;
  return tx.$queryRaw<Candidate[]>`
    SELECT c."id" AS "commentId", c."updatedAt" AS "updatedAt"
    FROM "Comment" c
    JOIN "Thread" t ON t."id" = c."threadId"
    JOIN "Actor" author ON author."id" = c."authorId" AND author."kind" = 'human'
    LEFT JOIN "Artifact" a ON a."id" = t."artifactId"
    LEFT JOIN "Delivery" d ON d."commentId" = c."id"
    WHERE t."state" = 'open'
      AND (t."artifactId" IS NULL OR a."deletedAt" IS NULL)
      AND (d."commentId" IS NULL OR d."handledAt" IS NULL)
      AND ${scopeSql(scope)}
      ${settled}
    ORDER BY c."createdAt", c."id"
    LIMIT ${CLAIM_BATCH}
    ${lock ? Prisma.sql`FOR UPDATE OF c SKIP LOCKED` : Prisma.empty}`;
}

async function deliveries(tx: Pick<Tx, "$queryRaw">, ids: string[]) {
  const rows = await tx.$queryRaw<DeliveryRow[]>`
    SELECT d."commentId", d."actorId", d."ackedAt", a."lastSeenAt" AS "actorLastSeenAt"
    FROM "Delivery" d JOIN "Actor" a ON a."id" = d."actorId"
    WHERE d."commentId" = ANY(${ids}::text[])
    FOR UPDATE OF d`;
  return new Map(rows.map((row) => [row.commentId, row]));
}

type CommentLike = {
  id: string;
  body: string;
  createdAt: Date;
  author: { key: string; kind: "human" | "agent" | "runner"; name: string };
};

function commentView(comment: CommentLike) {
  return {
    id: comment.id,
    body: comment.body,
    author: {
      key: comment.author.key,
      kind: comment.author.kind,
      name: comment.author.name,
    },
    createdAt: iso(comment.createdAt),
  };
}

function defaultScope(
  actor: Caller,
  scope: FeedbackScope | undefined,
): FeedbackScope {
  if (scope !== undefined) return scope;
  if (actor.workspaceKey === null)
    throw new ArtifactsError(
      "BAD_REQUEST",
      "No workspace: send an actor with hostname and worktree, or name a scope",
    );
  return { type: "owner", ownerKey: actor.workspaceKey };
}

export function createFeedback(deps: Deps) {
  const { db } = deps;

  async function assertWritable() {
    if (!(await deps.settings.value("artifactsEnabled")))
      throw new ArtifactsError("FORBIDDEN", "Artifacts is paused");
  }

  async function settleMs() {
    return (await deps.settings.value("feedbackSettleSeconds")) * 1000;
  }

  async function nextDeliverable(
    scope: FeedbackScope,
    settle: number,
  ): Promise<Date | null> {
    const now = deps.now();
    const rows = await db.$queryRaw<{ next: Date | null }[]>`
      SELECT MIN(c."updatedAt") AS "next"
      FROM "Comment" c
      JOIN "Thread" t ON t."id" = c."threadId"
      JOIN "Actor" author ON author."id" = c."authorId" AND author."kind" = 'human'
      LEFT JOIN "Artifact" a ON a."id" = t."artifactId"
      LEFT JOIN "Delivery" d ON d."commentId" = c."id"
      WHERE t."state" = 'open'
        AND (t."artifactId" IS NULL OR a."deletedAt" IS NULL)
        AND d."commentId" IS NULL
        AND c."updatedAt" > ${new Date(now.getTime() - settle)}
        AND ${scopeSql(scope)}`;
    const next = rows[0]?.next ?? null;
    return next === null ? null : new Date(next.getTime() + settle);
  }

  async function items(
    ids: string[],
    attempts: Map<string, number>,
  ): Promise<FeedbackItem[]> {
    if (ids.length === 0) return [];
    const comments = await db.comment.findMany({
      where: { id: { in: ids } },
      include: {
        author: true,
        thread: {
          include: {
            board: true,
            version: { select: { number: true } },
            artifact: {
              include: { currentVersion: { select: { number: true } } },
            },
            comments: {
              orderBy: { createdAt: "asc" },
              include: { author: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return comments.map((comment) => {
      const { thread } = comment;
      const artifact = thread.artifact;
      return {
        comment: commentView(comment),
        attempt: attempts.get(comment.id) ?? 1,
        thread: {
          id: thread.id,
          anchor: AnchorSchema.parse(thread.anchor),
          state: thread.state,
          priorComments: thread.comments
            .filter(
              (other) =>
                other.createdAt < comment.createdAt && other.id !== comment.id,
            )
            .map((other) => commentView(other)),
        },
        artifact:
          artifact === null
            ? null
            : {
                id: artifact.id,
                title: artifact.title,
                commentedOnVersion: thread.version?.number ?? null,
                currentVersion: artifact.currentVersion?.number ?? 1,
              },
        reviewUrl:
          artifact === null
            ? `${deps.origins.app}/b/${thread.board.slug}`
            : `${deps.origins.app}/a/${artifact.id}`,
      };
    });
  }

  async function pendingFor(scope: FeedbackScope, actorId: string) {
    const [settle, orphanMinutes] = await Promise.all([
      settleMs(),
      deps.settings.value("deliveryOrphanMinutes"),
    ]);
    const now = deps.now();
    const found = await candidates(
      db,
      scope,
      new Date(now.getTime() - settle),
      false,
    );
    const held = await db.delivery.findMany({
      where: { commentId: { in: found.map((row) => row.commentId) } },
      include: { actor: true },
    });
    const byComment = new Map(held.map((row) => [row.commentId, row]));
    let deliverable = 0;
    for (const row of found) {
      const current = byComment.get(row.commentId);
      const decision = claimDecision(
        {
          delivery:
            current === undefined
              ? null
              : {
                  actorId: current.actorId,
                  actorLastSeenAt: current.actor.lastSeenAt,
                  ackedAt: current.ackedAt,
                },
        },
        { now, actorId, orphanMs: orphanMinutes * MINUTE_MS },
      );
      if (decision !== "skip") deliverable += 1;
    }
    const next = await nextDeliverable(scope, settle);
    const all = await candidates(db, scope, null, false);
    const settling = all.filter(
      (row) => deliverableAt(row.updatedAt, settle / 1000) > now,
    ).length;
    return {
      deliverable,
      settling,
      nextDeliverableAt: next === null ? null : next.toISOString(),
    };
  }

  return {
    pendingFor,

    /**
     * Hands the caller every settled human comment in scope it may take, in
     * one transaction that locks candidates with SKIP LOCKED so two claimers
     * never receive the same comment.
     */
    async claim(
      input: { scope?: FeedbackScope | undefined },
      actor: Caller,
      requestId: string,
    ): Promise<FeedbackClaimResponse> {
      await assertWritable();
      const scope = defaultScope(actor, input.scope);
      const [settle, orphanMinutes] = await Promise.all([
        settleMs(),
        deps.settings.value("deliveryOrphanMinutes"),
      ]);
      const now = deps.now();
      const claimed = await transact(db, async (tx) => {
        const found = await candidates(
          tx,
          scope,
          new Date(now.getTime() - settle),
          true,
        );
        const held = await deliveries(
          tx,
          found.map((row) => row.commentId),
        );
        const attempts = new Map<string, number>();
        const events = [];
        for (const row of found) {
          const current = held.get(row.commentId);
          const decision = claimDecision(
            {
              delivery:
                current === undefined
                  ? null
                  : {
                      actorId: current.actorId,
                      actorLastSeenAt: current.actorLastSeenAt,
                      ackedAt: current.ackedAt,
                    },
            },
            { now, actorId: actor.id, orphanMs: orphanMinutes * MINUTE_MS },
          );
          if (decision === "skip") continue;
          if (decision === "claim") {
            await tx.delivery.create({
              data: {
                commentId: row.commentId,
                actorId: actor.id,
                claimedAt: now,
              },
            });
            attempts.set(row.commentId, 1);
          } else {
            const updated = await tx.delivery.update({
              where: { commentId: row.commentId },
              data: {
                actorId: actor.id,
                claimedAt: now,
                ackedAt: null,
                attempts: { increment: 1 },
              },
            });
            attempts.set(row.commentId, updated.attempts);
          }
          events.push({
            boardId: null,
            kind: "delivery.claimed",
            entityId: row.commentId,
            actorId: actor.id,
            requestId,
          });
        }
        if (events.length > 0) {
          const boards = await tx.comment.findMany({
            where: { id: { in: events.map((event) => event.entityId) } },
            select: { id: true, thread: { select: { boardId: true } } },
          });
          const boardOf = new Map(boards.map((c) => [c.id, c.thread.boardId]));
          await recordEvents(
            tx,
            events.map((event) => ({
              ...event,
              boardId: boardOf.get(event.entityId) ?? null,
            })),
          );
        }
        return attempts;
      });
      const [list, next] = await Promise.all([
        items([...claimed.keys()], claimed),
        nextDeliverable(scope, settle),
      ]);
      return {
        items: list,
        nextDeliverableAt: next === null ? null : next.toISOString(),
      };
    },

    /** Marks comments the caller received as delivered; never returned again. */
    async ack(
      commentIds: string[],
      actor: Caller,
      requestId: string,
    ): Promise<{ acked: number }> {
      await assertWritable();
      return transact(db, async (tx) => {
        const rows = await tx.delivery.updateManyAndReturn({
          where: {
            commentId: { in: commentIds },
            actorId: actor.id,
            ackedAt: null,
          },
          data: { ackedAt: deps.now() },
          select: {
            commentId: true,
            comment: { select: { thread: { select: { boardId: true } } } },
          },
        });
        await recordEvents(
          tx,
          rows.map((row) => ({
            boardId: row.comment.thread.boardId,
            kind: "delivery.acked",
            entityId: row.commentId,
            actorId: actor.id,
            requestId,
          })),
        );
        return { acked: rows.length };
      });
    },

    /** What `claim` would take or soon will, without taking it. */
    async pending(
      input: { scope?: FeedbackScope | undefined },
      actor: Caller,
    ): Promise<{
      deliverable: number;
      settling: number;
      nextDeliverableAt: string | null;
    }> {
      const scope = defaultScope(actor, input.scope);
      return pendingFor(scope, actor.id);
    },

    /** The UI's "send again": forget the delivery so the comment is claimable. */
    async redeliver(commentId: string, actor: Caller, requestId: string) {
      await assertWritable();
      if (actor.kind !== "human")
        throw new ArtifactsError(
          "FORBIDDEN",
          "Only a human can redeliver a comment",
        );
      await transact(db, async (tx) => {
        const comment = await tx.comment.findUnique({
          where: { id: commentId },
          include: { thread: true },
        });
        if (comment === null)
          throw new ArtifactsError("NOT_FOUND", "Comment not found");
        await tx.delivery.deleteMany({ where: { commentId } });
        await recordEvents(tx, [
          {
            boardId: comment.thread.boardId,
            kind: "delivery.redelivered",
            entityId: commentId,
            actorId: actor.id,
            requestId,
            payload: {
              threadId: comment.threadId,
              artifactId: comment.thread.artifactId,
              commentId,
            },
          },
        ]);
      });
      return { ok: true as const };
    },
  };
}
export type Feedback = ReturnType<typeof createFeedback>;
