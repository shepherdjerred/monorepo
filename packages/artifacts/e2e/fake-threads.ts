/** Threads, comments and the feedback delivery state machine. */
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { Actor, FeedbackItem, FeedbackScope } from "#shared/contract.ts";
import type {
  CommentEditInputSchema,
  FeedbackPendingOutputSchema,
  InboxListOutputSchema,
  ThreadCreateInputSchema,
  ThreadReplyInputSchema,
  ThreadViewSchema,
} from "#shared/procedures.ts";
import {
  bumpActivity,
  currentVersionOf,
  requireArtifact,
  requireBoard,
  requireVersion,
  summarizeBoard,
} from "./fake-boards.ts";
import { emitChange, notifyFeedback, scopeMatches } from "./fake-hub.ts";
import {
  actorRef,
  badRequest,
  iso,
  notFound,
  origins,
  ownerKeyOf,
  type ArtifactRec,
  type CommentRec,
  type DeliveryRec,
  type Store,
  type ThreadRec,
} from "./fake-types.ts";

type ThreadView = z.input<typeof ThreadViewSchema>;

// ── Serializers ─────────────────────────────────────────────────────────────

function viewComment(
  store: Store,
  comment: CommentRec,
): ThreadView["comments"][number] {
  const { delivery } = comment;
  return {
    id: comment.id,
    body: comment.body,
    author: comment.author,
    createdAt: iso(comment.createdAt),
    updatedAt: iso(comment.updatedAt),
    delivery:
      delivery === null
        ? null
        : {
            state: delivery.state,
            actor: delivery.actor,
            claimedAt:
              delivery.claimedAt === null ? null : iso(delivery.claimedAt),
            handledAt:
              delivery.handledAt === null ? null : iso(delivery.handledAt),
            attempts: delivery.attempts,
          },
    editableUntil:
      delivery?.state === "queued"
        ? iso(comment.createdAt + store.options.editWindowMs)
        : null,
  };
}

export function viewThread(store: Store, thread: ThreadRec): ThreadView {
  const version =
    thread.versionId === null
      ? undefined
      : store.versions.get(thread.versionId);
  return {
    id: thread.id,
    boardId: thread.boardId,
    artifactId: thread.artifactId,
    versionId: thread.versionId,
    versionNumber: version?.number ?? null,
    anchor: thread.anchor,
    state: thread.state,
    createdAt: iso(thread.createdAt),
    resolvedAt: thread.resolvedAt === null ? null : iso(thread.resolvedAt),
    comments: thread.comments.map((comment) => viewComment(store, comment)),
  };
}

export function requireThread(store: Store, id: string): ThreadRec {
  const thread = store.threads.get(id);
  if (thread === undefined) throw notFound(`thread ${id}`);
  return thread;
}

function findComment(
  store: Store,
  commentId: string,
): { thread: ThreadRec; comment: CommentRec } {
  for (const thread of store.threads.values()) {
    const comment = thread.comments.find((entry) => entry.id === commentId);
    if (comment !== undefined) return { thread, comment };
  }
  throw notFound(`comment ${commentId}`);
}

// ── Threads and comments ────────────────────────────────────────────────────

function makeComment(store: Store, actor: Actor, body: string): CommentRec {
  const now = store.options.now();
  return {
    id: crypto.randomUUID(),
    body,
    author: actorRef(actor),
    createdAt: now,
    updatedAt: now,
    delivery:
      actor.kind === "human"
        ? {
            state: "queued",
            actor: null,
            claimedAt: null,
            handledAt: null,
            attempts: 0,
          }
        : null,
  };
}

/** An agent's reply or resolve answers every comment it was handed. */
function markHandled(store: Store, thread: ThreadRec, actor: Actor): void {
  if (actor.kind === "human") return;
  const now = store.options.now();
  for (const comment of thread.comments) {
    const { delivery } = comment;
    if (delivery?.state === "claimed" || delivery?.state === "delivered") {
      delivery.state = "handled";
      delivery.handledAt = now;
    }
  }
}

const ARTIFACT_ANCHORS = new Set(["frame", "doc", "page", "time"]);

export function createThread(
  store: Store,
  actor: Actor,
  input: z.infer<typeof ThreadCreateInputSchema>,
): ThreadView {
  const board = requireBoard(store, input.board);
  if (ARTIFACT_ANCHORS.has(input.anchor.type) && input.artifactId === undefined)
    throw badRequest(`a ${input.anchor.type} anchor needs an artifactId`);
  if (input.anchor.type === "board" && input.artifactId !== undefined)
    throw badRequest("a board anchor cannot name an artifact");
  if (input.versionId !== undefined && input.artifactId === undefined)
    throw badRequest("versionId needs an artifactId");
  let versionId: string | null = null;
  if (input.artifactId !== undefined) {
    const artifact = requireArtifact(store, input.artifactId);
    if (artifact.boardId !== board.id)
      throw badRequest("the artifact is not on this board");
    if (input.versionId === undefined) {
      versionId = currentVersionOf(store, artifact)?.id ?? null;
    } else {
      const version = requireVersion(store, input.versionId);
      if (version.artifactId !== artifact.id)
        throw badRequest("the version belongs to another artifact");
      versionId = version.id;
    }
  }
  const comment = makeComment(store, actor, input.body);
  const thread: ThreadRec = {
    id: crypto.randomUUID(),
    boardId: board.id,
    artifactId: input.artifactId ?? null,
    versionId,
    anchor: input.anchor,
    state: "open",
    createdAt: comment.createdAt,
    resolvedAt: null,
    comments: [comment],
  };
  store.threads.set(thread.id, thread);
  bumpActivity(store, board);
  afterComment(store, thread, comment);
  return viewThread(store, thread);
}

function afterComment(
  store: Store,
  thread: ThreadRec,
  comment: CommentRec,
): void {
  emitChange(store, thread.boardId, "thread", thread.id);
  if (comment.delivery !== null) notifyFeedback(store, thread, comment);
}

export function replyToThread(
  store: Store,
  actor: Actor,
  input: z.infer<typeof ThreadReplyInputSchema>,
): ThreadView {
  const thread = requireThread(store, input.threadId);
  if (thread.state === "resolved")
    throw badRequest("the thread is resolved; reopen it before replying");
  const comment = makeComment(store, actor, input.body);
  thread.comments.push(comment);
  markHandled(store, thread, actor);
  if (input.resolve) setThreadState(store, actor, thread, "resolved");
  const board = store.boards.get(thread.boardId);
  if (board !== undefined) bumpActivity(store, board);
  afterComment(store, thread, comment);
  return viewThread(store, thread);
}

export function setThreadState(
  store: Store,
  actor: Actor,
  thread: ThreadRec,
  state: "open" | "resolved",
): void {
  if (thread.state === state) return;
  thread.state = state;
  thread.resolvedAt = state === "resolved" ? store.options.now() : null;
  if (state === "resolved") markHandled(store, thread, actor);
  emitChange(store, thread.boardId, "thread", thread.id);
}

/** The author may edit or delete a comment until it settles; once claimed it is locked. */
function assertAuthorMayChange(
  store: Store,
  actor: Actor,
  comment: CommentRec,
): void {
  if (comment.author.key !== actor.key)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "only the author may change a comment",
    });
  const { delivery } = comment;
  if (delivery === null)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "agent replies cannot be changed",
    });
  if (delivery.state !== "queued")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "the comment was already claimed by an agent",
    });
  if (store.options.now() >= comment.createdAt + store.options.editWindowMs)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "the edit window has passed",
    });
}

export function editComment(
  store: Store,
  actor: Actor,
  input: z.infer<typeof CommentEditInputSchema>,
): ThreadView {
  const { thread, comment } = findComment(store, input.commentId);
  assertAuthorMayChange(store, actor, comment);
  comment.body = input.body;
  comment.updatedAt = store.options.now();
  emitChange(store, thread.boardId, "thread", thread.id);
  return viewThread(store, thread);
}

export function deleteComment(
  store: Store,
  actor: Actor,
  commentId: string,
): ThreadView | null {
  const { thread, comment } = findComment(store, commentId);
  assertAuthorMayChange(store, actor, comment);
  thread.comments.splice(thread.comments.indexOf(comment), 1);
  emitChange(store, thread.boardId, "thread", thread.id);
  if (thread.comments.length > 0) return viewThread(store, thread);
  store.threads.delete(thread.id);
  return null;
}

// ── Feedback delivery ───────────────────────────────────────────────────────

export function defaultScope(actor: Actor): FeedbackScope {
  return { type: "owner", ownerKey: ownerKeyOf(actor) };
}

type Candidate = { thread: ThreadRec; comment: CommentRec; settled: boolean };

/** Unclaimed, the caller's own unacked claim, or held by an actor that went silent. */
function isAvailable(
  store: Store,
  actor: Actor,
  delivery: DeliveryRec,
): boolean {
  if (delivery.state === "queued") return true;
  const holder = delivery.actor?.key;
  if (holder === undefined) return false;
  return holder === actor.key
    ? delivery.state === "claimed"
    : store.options.now() - (store.seen.get(holder) ?? 0) >
        store.options.orphanMs;
}

/** Comments the actor may be handed: unclaimed, its own unacked claims, or an absent actor's. */
function candidates(
  store: Store,
  actor: Actor,
  scope: FeedbackScope,
): Candidate[] {
  const now = store.options.now();
  const found: Candidate[] = [];
  for (const thread of store.threads.values()) {
    if (thread.state !== "open" || !scopeMatches(store, scope, thread))
      continue;
    for (const comment of thread.comments) {
      const { delivery } = comment;
      if (delivery === null || delivery.state === "handled") continue;
      if (isAvailable(store, actor, delivery))
        found.push({
          thread,
          comment,
          settled: now >= comment.createdAt + store.options.settleMs,
        });
    }
  }
  return found.toSorted((a, b) => a.comment.createdAt - b.comment.createdAt);
}

function nextSettle(
  store: Store,
  pending: readonly Candidate[],
): string | null {
  const times = pending
    .filter((entry) => !entry.settled)
    .map((entry) => entry.comment.createdAt + store.options.settleMs);
  return times.length === 0 ? null : iso(Math.min(...times));
}

function feedbackItem(
  store: Store,
  entry: Candidate,
  attempt: number,
): FeedbackItem {
  const { thread, comment } = entry;
  const artifact =
    thread.artifactId === null
      ? undefined
      : store.artifacts.get(thread.artifactId);
  const board = store.boards.get(thread.boardId);
  const current =
    artifact === undefined ? null : currentVersionOf(store, artifact);
  const commentedOn =
    thread.versionId === null
      ? null
      : (store.versions.get(thread.versionId)?.number ?? null);
  const view = (source: CommentRec): FeedbackItem["comment"] => ({
    id: source.id,
    body: source.body,
    author: source.author,
    createdAt: iso(source.createdAt),
  });
  const reviewUrl =
    artifact === undefined
      ? `${origins(store).app}/b/${board?.slug ?? ""}`
      : `${origins(store).app}/a/${artifact.id}${commentedOn === null ? "" : `?v=${String(commentedOn)}`}`;
  return {
    comment: view(comment),
    attempt,
    thread: {
      id: thread.id,
      anchor: thread.anchor,
      state: thread.state,
      priorComments: thread.comments
        .slice(0, thread.comments.indexOf(comment))
        .map((prior) => view(prior)),
    },
    artifact:
      artifact === undefined || current === null
        ? null
        : {
            id: artifact.id,
            title: artifact.title,
            commentedOnVersion: commentedOn,
            currentVersion: current.number,
          },
    reviewUrl,
  };
}

export function claimFeedback(
  store: Store,
  actor: Actor,
  scope: FeedbackScope,
): { items: FeedbackItem[]; nextDeliverableAt: string | null } {
  const found = candidates(store, actor, scope);
  const items: FeedbackItem[] = [];
  const now = store.options.now();
  for (const entry of found.filter((candidate) => candidate.settled)) {
    const { delivery } = entry.comment;
    if (delivery === null) continue;
    delivery.state = "claimed";
    delivery.actor = actorRef(actor);
    delivery.claimedAt = now;
    delivery.attempts += 1;
    items.push(feedbackItem(store, entry, delivery.attempts));
    emitChange(store, entry.thread.boardId, "delivery", entry.comment.id);
  }
  return { items, nextDeliverableAt: nextSettle(store, found) };
}

export function ackFeedback(
  store: Store,
  actor: Actor,
  commentIds: readonly string[],
): number {
  let acked = 0;
  for (const id of commentIds) {
    for (const thread of store.threads.values()) {
      const delivery = thread.comments.find(
        (comment) => comment.id === id,
      )?.delivery;
      if (delivery?.state !== "claimed" || delivery.actor?.key !== actor.key)
        continue;
      delivery.state = "delivered";
      acked += 1;
      emitChange(store, thread.boardId, "delivery", id);
    }
  }
  return acked;
}

export function pendingFeedback(
  store: Store,
  actor: Actor,
  scope: FeedbackScope,
): z.input<typeof FeedbackPendingOutputSchema> {
  const found = candidates(store, actor, scope);
  return {
    deliverable: found.filter((entry) => entry.settled).length,
    settling: found.filter((entry) => !entry.settled).length,
    nextDeliverableAt: nextSettle(store, found),
  };
}

export function redeliver(store: Store, commentId: string): void {
  const { thread, comment } = findComment(store, commentId);
  if (comment.delivery === null)
    throw badRequest("only a human comment can be redelivered");
  comment.delivery = {
    ...comment.delivery,
    state: "queued",
    actor: null,
    claimedAt: null,
    handledAt: null,
  };
  emitChange(store, thread.boardId, "delivery", comment.id);
}

// ── Inbox ───────────────────────────────────────────────────────────────────

/** The current version has no human comment since it was published. */
function needsReviewOf(store: Store, artifact: ArtifactRec): boolean {
  const current = currentVersionOf(store, artifact);
  return (
    current !== null &&
    ![...store.threads.values()].some(
      (thread) =>
        thread.artifactId === artifact.id &&
        thread.comments.some(
          (comment) =>
            comment.delivery !== null && comment.createdAt >= current.createdAt,
        ),
    )
  );
}

export function inboxList(store: Store): z.input<typeof InboxListOutputSchema> {
  const boards = [...store.boards.values()].toSorted(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  );
  return {
    boards: boards.map((board) => {
      const threads = [...store.threads.values()].filter(
        (thread) => thread.boardId === board.id && thread.state === "open",
      );
      const needsReview = [...store.artifacts.values()].filter(
        (artifact) =>
          artifact.boardId === board.id && needsReviewOf(store, artifact),
      ).length;
      return {
        ...summarizeBoard(store, board),
        needsReviewCount: needsReview,
        openThreadCount: threads.length,
        unhandledCount: threads.filter((thread) =>
          thread.comments.some(
            (comment) =>
              comment.delivery !== null && comment.delivery.state !== "handled",
          ),
        ).length,
      };
    }),
  };
}
