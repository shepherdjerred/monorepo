/**
 * Input and output schemas of the tRPC procedures. Timestamps are ISO-8601
 * strings, byte counts are numbers, and a content token only ever appears
 * inside a `contentUrl`.
 */
import { z } from "zod";
import {
  ActorRefSchema,
  AnchorSchema,
  ArtifactKindSchema,
  BoardIndexSchema,
  BoardOpSchema,
  BoardSlugSchema,
  FeedbackScopeSchema,
  Sha256Schema,
  ThreadStateSchema,
  ViewportSchema,
} from "./contract.ts";

const Timestamp = z.iso.datetime();
const Id = z.uuid();
const Bytes = z.number().int().min(0);

// ── Boards ──────────────────────────────────────────────────────────────────

export const BoardSummarySchema = z.strictObject({
  id: Id,
  slug: BoardSlugSchema,
  title: z.string(),
  revision: z.number().int().min(1),
  keep: z.boolean(),
  createdAt: Timestamp,
  lastActivityAt: Timestamp,
  archivedAt: Timestamp.nullable(),
  /** Set once the cleanup purged the board's content; threads remain. */
  expiredAt: Timestamp.nullable(),
  /** When the cleanup will purge the board; null when kept or already purged. */
  expiresAt: Timestamp.nullable(),
  artifactCount: z.number().int().min(0),
  totalBytes: Bytes,
});
export type BoardSummary = z.infer<typeof BoardSummarySchema>;

export const BoardListInputSchema = z
  .strictObject({
    state: z.enum(["active", "archived", "kept", "all"]).default("all"),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .default({ state: "all", limit: 200 });

export const BoardRefInputSchema = z.strictObject({ slug: BoardSlugSchema });

export const BoardCreateInputSchema = z.strictObject({
  slug: BoardSlugSchema,
  title: z.string().trim().min(1).max(200),
});

export const BoardUpdateInputSchema = z.strictObject({
  slug: BoardSlugSchema,
  title: z.string().trim().min(1).max(200),
});

export const BoardArchiveInputSchema = z.strictObject({
  slug: BoardSlugSchema,
  archived: z.boolean(),
});

export const BoardKeepInputSchema = z.strictObject({
  slug: BoardSlugSchema,
  keep: z.boolean(),
});

export const BoardApplyOpsInputSchema = z.strictObject({
  slug: BoardSlugSchema,
  ops: z.array(BoardOpSchema).min(1).max(500),
});

export const BoardReplaceInputSchema = z.strictObject({
  slug: BoardSlugSchema,
  expectedRevision: z.number().int().min(1),
  index: BoardIndexSchema,
});

export const BoardDocumentSchema = z.strictObject({
  revision: z.number().int().min(1),
  index: BoardIndexSchema,
});
export type BoardDocument = z.infer<typeof BoardDocumentSchema>;

/**
 * The `data.conflict` of a `CONFLICT` error from `boards.replace`: the
 * document the caller must merge into before retrying.
 */
export const BoardConflictSchema = BoardDocumentSchema;

// ── Artifacts and versions ──────────────────────────────────────────────────

export const VersionSummarySchema = z.strictObject({
  id: Id,
  artifactId: Id,
  number: z.number().int().min(1),
  entryPath: z.string(),
  totalBytes: Bytes,
  fileCount: z.number().int().min(0),
  note: z.string(),
  viewport: ViewportSchema.nullable(),
  createdAt: Timestamp,
  publisher: ActorRefSchema,
  /** True once the cleanup deleted the version's files. */
  purged: z.boolean(),
});
export type VersionSummary = z.infer<typeof VersionSummarySchema>;

export const VersionFileViewSchema = z.strictObject({
  path: z.string(),
  sha256: Sha256Schema,
  size: Bytes,
  mediaType: z.string(),
});
export type VersionFileView = z.infer<typeof VersionFileViewSchema>;

/**
 * One version with its manifest. `contentUrl` is the content-host prefix
 * (`https://<content-host>/_t/<token>/`) a viewer frames, and null once purged.
 */
export const VersionViewSchema = VersionSummarySchema.extend({
  contentUrl: z.url().nullable(),
  files: z.array(VersionFileViewSchema),
});
export type VersionView = z.infer<typeof VersionViewSchema>;

export const ArtifactSummarySchema = z.strictObject({
  id: Id,
  boardId: Id,
  boardSlug: BoardSlugSchema,
  boardTitle: z.string(),
  title: z.string(),
  kind: ArtifactKindSchema,
  ownerKey: z.string(),
  createdAt: Timestamp,
  versionCount: z.number().int().min(0),
  openThreadCount: z.number().int().min(0),
  currentVersion: VersionSummarySchema.nullable(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const ArtifactListInputSchema = z
  .strictObject({
    board: BoardSlugSchema.optional(),
    ownerKey: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .default({ limit: 200 });

export const ArtifactRefInputSchema = z.strictObject({ id: Id });

export const ArtifactRenameInputSchema = z.strictObject({
  id: Id,
  title: z.string().trim().min(1).max(200),
});

export const ArtifactDetailSchema = ArtifactSummarySchema.extend({
  current: VersionViewSchema.nullable(),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetailSchema>;

export const VersionRefInputSchema = z.strictObject({ id: Id });

export const RotateTokenOutputSchema = z.strictObject({
  contentUrl: z.url(),
});

// ── Threads ─────────────────────────────────────────────────────────────────

/** Where a human comment is on its way to an agent. */
export const DeliveryStatusSchema = z.strictObject({
  state: z.enum(["queued", "claimed", "delivered", "handled"]),
  actor: ActorRefSchema.nullable(),
  claimedAt: Timestamp.nullable(),
  handledAt: Timestamp.nullable(),
  attempts: z.number().int().min(0),
});
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const ThreadCommentSchema = z.strictObject({
  id: Id,
  body: z.string(),
  author: ActorRefSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** Human comments only; agent replies are never delivered. */
  delivery: DeliveryStatusSchema.nullable(),
  /** The author may still edit or delete until this instant. */
  editableUntil: Timestamp.nullable(),
});
export type ThreadComment = z.infer<typeof ThreadCommentSchema>;

export const ThreadViewSchema = z.strictObject({
  id: Id,
  boardId: Id,
  artifactId: Id.nullable(),
  versionId: Id.nullable(),
  /** The number of the version the thread was opened on. */
  versionNumber: z.number().int().min(1).nullable(),
  anchor: AnchorSchema,
  state: ThreadStateSchema,
  createdAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
  comments: z.array(ThreadCommentSchema),
});
export type ThreadView = z.infer<typeof ThreadViewSchema>;

export const ThreadListInputSchema = z.strictObject({
  board: BoardSlugSchema.optional(),
  artifactId: Id.optional(),
  state: ThreadStateSchema.optional(),
});

export const ThreadRefInputSchema = z.strictObject({ threadId: Id });

const CommentBody = z.string().trim().min(1).max(20_000);

export const ThreadCreateInputSchema = z.strictObject({
  board: BoardSlugSchema,
  /** Required for artifact anchors (`frame`, `doc`, `page`, `time`). */
  artifactId: Id.optional(),
  versionId: Id.optional(),
  anchor: AnchorSchema,
  body: CommentBody,
});

export const ThreadReplyInputSchema = z.strictObject({
  threadId: Id,
  body: CommentBody,
  /** Resolve the thread in the same transaction as the reply. */
  resolve: z.boolean().default(false),
});

export const CommentEditInputSchema = z.strictObject({
  commentId: Id,
  body: CommentBody,
});

export const CommentRefInputSchema = z.strictObject({ commentId: Id });

// ── Feedback ────────────────────────────────────────────────────────────────

export const FeedbackClaimInputSchema = z.strictObject({
  /** Defaults to the caller's own artifacts (`owner` = its `workspaceKey`). */
  scope: FeedbackScopeSchema.optional(),
});

export const FeedbackAckInputSchema = z.strictObject({
  commentIds: z.array(Id).min(1).max(500),
});

export const FeedbackAckOutputSchema = z.strictObject({
  acked: z.number().int().min(0),
});

export const FeedbackPendingInputSchema = z.strictObject({
  scope: FeedbackScopeSchema.optional(),
});

export const FeedbackPendingOutputSchema = z.strictObject({
  /** Settled, undelivered human comments in scope. */
  deliverable: z.number().int().min(0),
  /** Comments still inside their settle window. */
  settling: z.number().int().min(0),
  nextDeliverableAt: Timestamp.nullable(),
});

export const FeedbackRedeliverInputSchema = z.strictObject({
  commentId: Id,
});

export const FeedbackWaitersInputSchema = z.strictObject({
  board: BoardSlugSchema.optional(),
  artifactId: Id.optional(),
});

export const FeedbackWaiterSchema = z.strictObject({
  actor: ActorRefSchema,
  scope: FeedbackScopeSchema,
  since: Timestamp,
});

export const FeedbackWaitersOutputSchema = z.strictObject({
  waiters: z.array(FeedbackWaiterSchema),
});

// ── Inbox and maintenance ───────────────────────────────────────────────────

/**
 * A board with what the inbox groups on. `needsReviewCount` counts artifacts
 * whose current version no human has commented on since it was published.
 */
export const InboxBoardSchema = BoardSummarySchema.extend({
  needsReviewCount: z.number().int().min(0),
  openThreadCount: z.number().int().min(0),
  /** Open threads holding a comment no agent has handled yet. */
  unhandledCount: z.number().int().min(0),
});
export type InboxBoard = z.infer<typeof InboxBoardSchema>;

export const InboxListOutputSchema = z.strictObject({
  boards: z.array(InboxBoardSchema),
});

export const MaintenanceStatusSchema = z.enum(["ok", "paused"]);

export const MaintenanceCleanupOutputSchema = z.strictObject({
  status: MaintenanceStatusSchema,
  expiredSessions: z.number().int().min(0),
  purgedBoards: z.number().int().min(0),
  deletedBlobs: z.number().int().min(0),
  /** Objects no `Blob` row named, swept after the blob grace. */
  deletedOrphans: z.number().int().min(0),
  prunedEvents: z.number().int().min(0),
  /** True when a bounded batch stopped early; run the cleanup again. */
  more: z.boolean(),
});
export type MaintenanceCleanupOutput = z.infer<
  typeof MaintenanceCleanupOutputSchema
>;

// ── Upload route bodies (Hono routes, not tRPC) ─────────────────────────────

/** The 409 body of `POST /api/uploads/:id/commit`. */
export const CommitConflictSchema = z.union([
  z.strictObject({
    error: z.string(),
    currentVersionId: Id.nullable(),
  }),
  z.strictObject({
    error: z.string(),
    missing: z.array(Sha256Schema),
  }),
]);
