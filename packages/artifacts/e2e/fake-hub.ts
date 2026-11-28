/** The live streams of the fake: UI change events and the agent feedback wake-ups. */
import {
  LiveMessageSchema,
  type FeedbackScope,
  type LiveMessage,
} from "#shared/contract.ts";
import {
  iso,
  type CommentRec,
  type Store,
  type Subscriber,
  type ThreadRec,
  type Waiter,
} from "./fake-types.ts";

/** Wakes every UI stream that follows the board; ids and counters only. */
export function emitChange(
  store: Store,
  boardId: string | null,
  kind: string,
  entityId: string,
): void {
  store.seq += 1;
  const slug =
    boardId === null ? null : (store.boards.get(boardId)?.slug ?? null);
  const message: LiveMessage = {
    type: "change",
    boardId,
    kind,
    entityId,
    seq: store.seq,
  };
  for (const subscriber of store.subscribers)
    if (subscriber.board === null || subscriber.board === slug)
      subscriber.send(message);
}

export function scopeMatches(
  store: Store,
  scope: FeedbackScope,
  thread: ThreadRec,
): boolean {
  switch (scope.type) {
    case "owner": {
      const artifact =
        thread.artifactId === null
          ? undefined
          : store.artifacts.get(thread.artifactId);
      return artifact?.ownerKey === scope.ownerKey;
    }
    case "board":
      return store.boards.get(thread.boardId)?.slug === scope.board;
    case "artifact":
      return thread.artifactId === scope.artifactId;
  }
}

/** Tells every waiting agent in scope that a human comment will become deliverable. */
export function notifyFeedback(
  store: Store,
  thread: ThreadRec,
  comment: CommentRec,
): void {
  const deliverableAt = iso(comment.createdAt + store.options.settleMs);
  for (const waiter of store.waiters)
    if (scopeMatches(store, waiter.scope, thread))
      waiter.send({
        type: "feedback",
        boardId: thread.boardId,
        artifactId: thread.artifactId,
        threadId: thread.id,
        commentId: comment.id,
        deliverableAt,
      });
}

function noop(): void {
  // nothing to clean up yet
}

type StreamSetup = (send: (message: LiveMessage) => void) => () => void;

/**
 * A Server-Sent Events response: `setup` registers the listener and returns its
 * cleanup, which runs when the client goes away. A comment line every
 * `heartbeatMs` keeps proxies from closing an idle stream.
 */
export function sseResponse(
  store: Store,
  signal: AbortSignal,
  setup: StreamSetup,
): Response {
  const encoder = new TextEncoder();
  let cleanup = noop;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string): void => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        cleanup();
        controller.close();
      };
      cleanup = setup((message) => {
        const checked = LiveMessageSchema.parse(message);
        write(`event: ${checked.type}\ndata: ${JSON.stringify(checked)}\n\n`);
        if (checked.type === "gone") close();
      });
      if (closed) {
        cleanup();
        return;
      }
      heartbeat = setInterval(() => {
        write(": heartbeat\n\n");
      }, store.options.heartbeatMs);
      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) close();
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export function subscribe(store: Store, subscriber: Subscriber): () => void {
  store.subscribers.add(subscriber);
  return () => store.subscribers.delete(subscriber);
}

/** The board a feedback scope belongs to, or null for an owner scope. */
function scopeBoardId(store: Store, scope: FeedbackScope): string | null {
  switch (scope.type) {
    case "owner":
      return null;
    case "artifact":
      return store.artifacts.get(scope.artifactId)?.boardId ?? null;
    case "board":
      return (
        [...store.boards.values()].find((board) => board.slug === scope.board)
          ?.id ?? null
      );
  }
}

/** Mirrors the server: a waiter connecting or leaving wakes the UI streams. */
function announceWaiter(store: Store, waiter: Waiter, entityId: string): void {
  const boardId = scopeBoardId(store, waiter.scope);
  const slug =
    boardId === null ? null : (store.boards.get(boardId)?.slug ?? null);
  const message: LiveMessage = {
    type: "change",
    boardId,
    kind: "waiter",
    entityId,
    seq: null,
  };
  for (const subscriber of store.subscribers)
    if (
      boardId === null ||
      subscriber.board === null ||
      subscriber.board === slug
    )
      subscriber.send(message);
}

export function addWaiter(store: Store, waiter: Waiter): () => void {
  const entityId = crypto.randomUUID();
  store.waiters.add(waiter);
  announceWaiter(store, waiter, entityId);
  return () => {
    if (store.waiters.delete(waiter)) announceWaiter(store, waiter, entityId);
  };
}
