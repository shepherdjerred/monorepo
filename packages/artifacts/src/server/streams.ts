import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  BoardSlugSchema,
  type FeedbackScope,
  type LiveMessage,
} from "#shared/contract.ts";
import { ArtifactsError } from "#application/errors.ts";
import type { Services } from "#application/services.ts";
import type { Caller } from "#application/types.ts";
import type { ChangeHub, HubMessage } from "#infrastructure/change-hub.ts";
import { reportError } from "#infrastructure/log.ts";
import { CLEANUP_EVENT } from "#application/maintenance.ts";
import type { AppVariables } from "./uploads-route.ts";

/** Below Bun's idle timeout, so an idle stream stays open. */
export const HEARTBEAT_MS = 8000;
const TOUCH_MS = 60_000;
/** A client this far behind refetches instead of replaying the backlog. */
const MAX_QUEUED = 1000;
const RESYNC: LiveMessage = { type: "resync" };
const RESYNC_NOTICE: HubMessage = { type: "resync" };

export type StreamStats = { feedback: number; events: number };

export type StreamOptions = {
  services: Services;
  hub: ChangeHub;
  stats: StreamStats;
  heartbeatMs?: number;
  touchMs?: number;
};

const EventPayloadSchema = z.looseObject({
  threadId: z.string().optional(),
  artifactId: z.string().nullable().optional(),
  commentId: z.string().optional(),
  human: z.boolean().optional(),
  deliverableAt: z.string().optional(),
  revision: z.number().int().optional(),
});

type Notice = Exclude<HubMessage, { type: "resync" }>;

/**
 * `idle` settles on the next `wake` or after one heartbeat, and leaves no
 * timer behind. A `wake` while nothing is idle is dropped: the loop re-reads
 * its queue before it idles again.
 */
function createWaiter(heartbeatMs: number) {
  let idling: PromiseWithResolvers<undefined> | undefined;
  return {
    wake: () => idling?.resolve(undefined),
    async idle() {
      const current = Promise.withResolvers<undefined>();
      idling = current;
      const timer = setTimeout(() => {
        current.resolve(undefined);
      }, heartbeatMs);
      try {
        await current.promise;
      } finally {
        clearTimeout(timer);
        idling = undefined;
      }
    },
  };
}

type Plan = {
  /** Sent once the hub subscription is live. */
  first: () => Promise<LiveMessage[]>;
  translate: (notice: Notice) => Promise<LiveMessage[]>;
  /** Called on each heartbeat tick. */
  tick?: () => Promise<void>;
  /** Called once when the connection ends, however it ends. */
  close?: () => void;
};

/**
 * One SSE connection. It subscribes to the hub first and only then computes
 * its first messages, so a change landing in between is queued, never lost.
 * Messages only wake the client: ids and counters, never a token or a body.
 */
function runStream(
  c: Context,
  options: StreamOptions,
  kind: keyof StreamStats,
  plan: Plan,
) {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  void options.hub.start();
  return streamSSE(c, async (stream) => {
    const queue: HubMessage[] = [];
    const state = { open: true };
    const isOpen = () => state.open;
    const waiter = createWaiter(heartbeatMs);
    const close = () => {
      state.open = false;
      waiter.wake();
    };
    const unsubscribe = options.hub.subscribe({
      message(message) {
        if (queue.length >= MAX_QUEUED)
          queue.splice(0, queue.length, RESYNC_NOTICE);
        else queue.push(message);
        waiter.wake();
      },
      closed: close,
    });
    stream.onAbort(() => {
      unsubscribe();
      close();
    });
    options.stats[kind] += 1;
    try {
      let first = true;
      const write = async (message: LiveMessage) => {
        await stream.writeSSE({
          event: message.type,
          data: JSON.stringify(message),
          ...(first ? { retry: 3000 } : {}),
        });
        first = false;
      };
      for (const message of await plan.first()) await write(message);
      while (isOpen() && !stream.aborted) {
        const notice = queue.shift();
        if (notice === undefined) {
          await waiter.idle();
          if (queue.length > 0 || !isOpen()) continue;
          await stream.write(": heartbeat\n\n");
          await plan.tick?.();
          continue;
        }
        const messages =
          notice.type === "resync" ? [RESYNC] : await plan.translate(notice);
        for (const message of messages) await write(message);
      }
    } finally {
      unsubscribe();
      options.stats[kind] -= 1;
      plan.close?.();
    }
  });
}

/** The scope a feedback stream covers, validated against what exists. */
async function streamScope(
  services: Services,
  c: Context,
  caller: Caller,
): Promise<{ scope: FeedbackScope; boardId: string | null }> {
  const board = c.req.query("board");
  const artifact = c.req.query("artifact");
  const { db } = services.deps;
  if (board !== undefined) {
    const slug = BoardSlugSchema.parse(board);
    const row = await db.board.findUnique({ where: { slug } });
    if (row === null) throw new ArtifactsError("NOT_FOUND", "Board not found");
    return { scope: { type: "board", board: slug }, boardId: row.id };
  }
  if (artifact !== undefined) {
    const id = z.uuid().parse(artifact);
    const row = await db.artifact.findFirst({ where: { id, deletedAt: null } });
    if (row === null)
      throw new ArtifactsError("NOT_FOUND", "Artifact not found");
    return {
      scope: { type: "artifact", artifactId: id },
      boardId: row.boardId,
    };
  }
  if (caller.workspaceKey === null)
    throw new ArtifactsError(
      "BAD_REQUEST",
      "No workspace: send an actor with hostname and worktree, or name a board or artifact",
    );
  return {
    scope: { type: "owner", ownerKey: caller.workspaceKey },
    boardId: null,
  };
}

/** Whether an event's comment belongs to a feedback scope. */
function createMembership(
  services: Services,
  scope: FeedbackScope,
  boardId: string | null,
) {
  const owned = new Map<string, boolean>();
  const { db } = services.deps;
  return async (
    eventBoardId: string | null,
    artifactId: string | null,
  ): Promise<boolean> => {
    if (scope.type === "board") return eventBoardId === boardId;
    if (scope.type === "artifact") return artifactId === scope.artifactId;
    const key = artifactId ?? `board:${eventBoardId ?? ""}`;
    const known = owned.get(key);
    if (known !== undefined) return known;
    const hit =
      artifactId === null
        ? eventBoardId !== null &&
          (await db.artifact.count({
            where: {
              boardId: eventBoardId,
              ownerKey: scope.ownerKey,
              deletedAt: null,
            },
          })) > 0
        : (await db.artifact.count({
            where: {
              id: artifactId,
              ownerKey: scope.ownerKey,
              deletedAt: null,
            },
          })) > 0;
    owned.set(key, hit);
    return hit;
  };
}

function registerFeedbackStream(
  app: Hono<{ Variables: AppVariables }>,
  options: StreamOptions,
) {
  const { services } = options;
  const touchMs = options.touchMs ?? TOUCH_MS;
  app.get("/api/feedback/stream", async (c) => {
    const caller = c.get("caller");
    const { scope, boardId } = await streamScope(services, c, caller);
    const inScope = createMembership(services, scope, boardId);
    let release: (() => void) | undefined;
    let touchedAt = Date.now();
    // Names this connection in `waiter` changes; ids only, never the actor.
    const connection = crypto.randomUUID();
    const announce = () => {
      options.hub.announce({ type: "waiter", boardId, entityId: connection });
    };
    const response = runStream(c, options, "feedback", {
      close: () => {
        if (release === undefined) return;
        release();
        release = undefined;
        announce();
      },
      first: async () => {
        release = services.waiters.add(
          { key: caller.key, kind: caller.kind, name: caller.name },
          scope,
          services.deps.now(),
        );
        // The UI's "waiting" header refetches on this, so it is announced
        // only once the waiter is listed.
        announce();
        const { deliverable } = await services.feedback.pendingFor(
          scope,
          caller.id,
        );
        return [{ type: "ready", scope, pending: deliverable }];
      },
      translate: async (notice) => {
        if (notice.type === "waiter") return [];
        const row = await services.deps.db.event.findUnique({
          where: { seq: BigInt(notice.seq) },
        });
        if (row === null) return [];
        const payload = EventPayloadSchema.parse(row.payload);
        const artifactId = payload.artifactId ?? null;
        if (row.kind === "artifact.deleted")
          return scope.type === "artifact" && artifactId === scope.artifactId
            ? [{ type: "gone" }]
            : [];
        if (!(await inScope(row.boardId, artifactId))) return [];
        if (
          (row.kind === "comment.created" || row.kind === "comment.updated") &&
          payload.human === true &&
          row.boardId !== null &&
          payload.threadId !== undefined &&
          payload.commentId !== undefined &&
          payload.deliverableAt !== undefined
        )
          return [
            {
              type: "feedback",
              boardId: row.boardId,
              artifactId,
              threadId: payload.threadId,
              commentId: payload.commentId,
              deliverableAt: payload.deliverableAt,
            },
          ];
        return row.kind === "delivery.redelivered" ||
          row.kind === "thread.reopened"
          ? [RESYNC]
          : [];
      },
      tick: async () => {
        if (Date.now() - touchedAt < touchMs) return;
        touchedAt = Date.now();
        await services.deps.db.actor
          .update({
            where: { id: caller.id },
            data: { lastSeenAt: services.deps.now() },
          })
          .catch((error: unknown) => {
            reportError(error, "artifacts_stream_touch_failed");
          });
      },
    });
    response.headers.set("X-Accel-Buffering", "no");
    return response;
  });
}

/**
 * The UI message for a waiter notice. A waiter on no one board (an owner
 * scope) is shown on every board; otherwise only on its own.
 */
function waiterChange(
  notice: Extract<HubMessage, { type: "waiter" }>,
  streamBoardId: string | null,
): LiveMessage[] {
  const elsewhere =
    notice.boardId !== null &&
    streamBoardId !== null &&
    notice.boardId !== streamBoardId;
  if (elsewhere) return [];
  return [
    {
      type: "change",
      boardId: notice.boardId,
      kind: "waiter",
      entityId: notice.entityId,
      seq: null,
    },
  ];
}

function registerEventsStream(
  app: Hono<{ Variables: AppVariables }>,
  options: StreamOptions,
) {
  const { services } = options;
  app.get("/api/events/stream", async (c) => {
    const slug = c.req.query("board");
    let boardId: string | null = null;
    if (slug !== undefined) {
      const board = await services.deps.db.board.findUnique({
        where: { slug: BoardSlugSchema.parse(slug) },
      });
      if (board === null)
        throw new ArtifactsError("NOT_FOUND", "Board not found");
      boardId = board.id;
    }
    return runStream(c, options, "events", {
      first: () => Promise.resolve([RESYNC]),
      translate: async (notice) => {
        if (notice.type === "waiter") return waiterChange(notice, boardId);
        if (notice.kind === CLEANUP_EVENT) return [];
        if (boardId !== null && notice.boardId !== boardId) return [];
        const row = await services.deps.db.event.findUnique({
          where: { seq: BigInt(notice.seq) },
        });
        if (row === null) return [];
        const messages: LiveMessage[] = [
          {
            type: "change",
            boardId: row.boardId,
            kind: row.kind,
            entityId: row.entityId,
            seq: notice.seq,
          },
        ];
        const payload = EventPayloadSchema.parse(row.payload);
        if (
          row.kind === "board.changed" &&
          row.boardId !== null &&
          payload.revision !== undefined
        )
          messages.push({
            type: "board",
            boardId: row.boardId,
            revision: payload.revision,
          });
        return messages;
      },
    });
  });
}

export function registerStreamRoutes(
  app: Hono<{ Variables: AppVariables }>,
  options: StreamOptions,
) {
  registerFeedbackStream(app, options);
  registerEventsStream(app, options);
}
