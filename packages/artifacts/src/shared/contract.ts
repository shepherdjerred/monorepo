/**
 * The frozen wire contract of the artifacts service, shared by the server, the
 * UI and `toolkit artifacts`. Exported as `@shepherdjerred/artifacts/contract`;
 * the tRPC procedure schemas are in `procedures.ts`.
 *
 * It imports nothing from the server, the database or the browser at runtime:
 * `AppRouter` is a type-only import, erased at build time.
 */
import { z } from "zod";
import { Coordinate, PageIndex, Size, Unit } from "./board-primitives.ts";
import { NoteSchema } from "./notes.ts";
import type { AppRouter as ServerRouter } from "#server/router.ts";

// ── Constants ───────────────────────────────────────────────────────────────

/** Carries a base64-encoded JSON `ActorSchema` document, as Tracker's header does. */
export const ACTOR_HEADER = "X-Artifacts-Actor";

/** Exit codes of `toolkit artifacts wait`, matching the `ci` commands. */
export const WAIT_EXIT_CODES = {
  ok: 0,
  usage: 2,
  gone: 4,
  timeout: 6,
} as const;

const MIB = 1024 * 1024;

/**
 * Defaults of the typed configuration. The server enforces the configured
 * values; schemas below check structure only, so a raised limit never needs a
 * contract change.
 */
export const LIMIT_DEFAULTS = {
  maxFileBytes: 500 * MIB,
  maxVersionBytes: 1024 * MIB,
  maxFiles: 2000,
  feedbackSettleSeconds: 10,
  deliveryOrphanMinutes: 15,
  boardIdleDays: 90,
  archiveGraceDays: 7,
} as const;

/**
 * Origins that content may load scripts, styles and fonts from. The content
 * Content-Security-Policy and `/agent/index.json` are both built from this list.
 */
export const ALLOWED_CDN_ORIGINS = [
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://unpkg.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
] as const;

/** Hard ceilings that keep a request bounded whatever the configured limits. */
const MAX_MANIFEST_FILES = 10_000;
const MAX_PATH_BYTES = 512;

// ── Actor ───────────────────────────────────────────────────────────────────

const ActorMetadataSchema = z.strictObject({
  harness: z.string().max(200).optional(),
  harnessVersion: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  sessionId: z.string().max(500).optional(),
  sessionLink: z.string().max(2000).optional(),
  executable: z.string().max(2000).optional(),
  hostname: z.string().max(200).optional(),
  branch: z.string().max(1000).optional(),
  worktree: z.string().max(2000).optional(),
  repoHead: z.string().max(200).optional(),
  cwd: z.string().max(2000).optional(),
  herdrWorkspace: z.string().max(500).optional(),
  hcTerminal: z.string().max(500).optional(),
  parentKey: z.string().max(500).optional(),
  plan: z.string().max(2000).optional(),
});

/**
 * The caller identity. Everything Tracker's actor carries parses here, so the
 * one `detectActor` of `toolkit` serves both services. `workspaceKey`
 * (`<hostname>:<worktree>`) scopes a bare `wait`; the server derives it from
 * `metadata.hostname` and `metadata.worktree` when the field is absent.
 */
export const ActorSchema = z.strictObject({
  key: z
    .string()
    .max(500)
    .regex(/^[a-z0-9][a-z0-9._-]*:\S+$/u),
  kind: z.enum(["human", "agent", "runner"]),
  name: z.string().trim().min(1).max(200),
  workspaceKey: z.string().min(1).max(2500).optional(),
  metadata: ActorMetadataSchema.default({}),
});
export type Actor = z.infer<typeof ActorSchema>;

export const ActorRefSchema = z.strictObject({
  key: z.string(),
  kind: z.enum(["human", "agent", "runner"]),
  name: z.string(),
});
export type ActorRef = z.infer<typeof ActorRefSchema>;

// ── Identifiers and paths ───────────────────────────────────────────────────

export const BoardSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u);
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const IdempotencyKeySchema = z.string().regex(/^[\w-]{16,128}$/u);
const NoteIdSchema = z.string().regex(/^[\w-]{1,64}$/u);
const Timestamp = z.iso.datetime();

export const ArtifactKindSchema = z.enum([
  "html",
  "site",
  "image",
  "video",
  "pdf",
  "markdown",
  "cast",
  "mermaid",
  "file",
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export class InvalidArtifactPathError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Invalid artifact path ${JSON.stringify(path)}: ${reason}`);
    this.name = "InvalidArtifactPathError";
  }
}

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x7f || code < 0x20) return true;
  }
  return false;
}

/**
 * Normalizes a path inside an artifact to Unicode NFC and rejects what could
 * escape or collide with the service's own namespace: `..` and `.` segments,
 * empty segments, backslashes, control characters (NUL included), a leading
 * `/`, a leading `_` (reserved for `_t`, `_bridge` and `_viewer`), and more
 * than 512 UTF-8 bytes. Throws `InvalidArtifactPathError`; idempotent.
 */
export function normalizeArtifactPath(input: string): string {
  const path = input.normalize("NFC");
  const reject = (reason: string): never => {
    throw new InvalidArtifactPathError(input, reason);
  };
  if (path === "") return reject("empty");
  if (new TextEncoder().encode(path).length > MAX_PATH_BYTES)
    return reject(`longer than ${String(MAX_PATH_BYTES)} bytes`);
  if (path.includes("\\")) return reject("contains a backslash");
  if (hasControlCharacter(path)) return reject("contains a control character");
  if (path.startsWith("/")) return reject("starts with /");
  if (path.startsWith("_")) return reject("starts with _ (reserved)");
  for (const segment of path.split("/")) {
    if (segment === "") return reject("contains an empty segment");
    if (segment === "." || segment === "..")
      return reject(`contains the ${segment} segment`);
  }
  return path;
}

/** A path that is already normalized: the wire never silently rewrites one. */
export const ArtifactPathSchema = z.string().superRefine((value, context) => {
  try {
    if (normalizeArtifactPath(value) !== value)
      context.addIssue({
        code: "custom",
        message: "path is not Unicode NFC",
      });
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid path",
    });
  }
});

// ── Board index ─────────────────────────────────────────────────────────────

export const FrameSchema = z.strictObject({
  page: PageIndex,
  x: Coordinate,
  y: Coordinate,
  w: Size,
  h: Size,
});
export type Frame = z.infer<typeof FrameSchema>;

export const LaunchSchema = z.strictObject({
  view: z.enum(["canvas", "focused"]),
  artifactId: z.uuid().optional(),
});
export type Launch = z.infer<typeof LaunchSchema>;

/**
 * The whole arrangement of a board, stored as one jsonb document with a
 * revision. `pages` name the board's pages; a frame's or note's `page` indexes
 * into them. `order` lists frame artifact ids and note ids back to front.
 */
export const BoardIndexSchema = z
  .strictObject({
    schema: z.literal(1),
    launch: LaunchSchema,
    pages: z
      .array(z.strictObject({ name: z.string().min(1).max(100) }))
      .min(1)
      .max(50),
    frames: z.record(z.uuid(), FrameSchema),
    order: z.array(z.string().min(1).max(64)),
    notes: z.record(NoteIdSchema, NoteSchema),
  })
  .superRefine((index, context) => {
    const pages = index.pages.length;
    for (const [id, frame] of Object.entries(index.frames))
      if (frame.page >= pages)
        context.addIssue({
          code: "custom",
          path: ["frames", id, "page"],
          message: "page is not in pages",
        });
    for (const [id, note] of Object.entries(index.notes))
      if (note.page >= pages)
        context.addIssue({
          code: "custom",
          path: ["notes", id, "page"],
          message: "page is not in pages",
        });
    const seen = new Set<string>();
    for (const [position, id] of index.order.entries()) {
      if (seen.has(id))
        context.addIssue({
          code: "custom",
          path: ["order", position],
          message: "duplicate id in order",
        });
      seen.add(id);
      if (!(id in index.frames) && !(id in index.notes))
        context.addIssue({
          code: "custom",
          path: ["order", position],
          message: "id is neither a frame nor a note",
        });
    }
  });
export type BoardIndex = z.infer<typeof BoardIndexSchema>;

/** The index of a board nothing was placed on. */
export const EMPTY_BOARD_INDEX: BoardIndex = {
  schema: 1,
  launch: { view: "canvas" },
  pages: [{ name: "Board" }],
  frames: {},
  order: [],
  notes: {},
};

/** Operations `boards.apply` merges under a row lock; it is never refused. */
export const BoardOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("placeFrame"),
    artifactId: z.uuid(),
    w: Size,
    h: Size,
    rightOf: z.uuid().optional(),
  }),
  z.strictObject({
    op: z.literal("moveFrames"),
    moves: z
      .array(
        z.strictObject({
          artifactId: z.uuid(),
          x: Coordinate,
          y: Coordinate,
          page: PageIndex.optional(),
          /** A resize: both optional, so a plain move leaves the size alone. */
          w: Size.optional(),
          h: Size.optional(),
        }),
      )
      .min(1)
      .max(500),
  }),
  z.strictObject({
    op: z.literal("reorder"),
    order: z.array(z.string().min(1).max(64)),
  }),
  z.strictObject({
    op: z.literal("putNote"),
    id: NoteIdSchema,
    note: NoteSchema,
  }),
  z.strictObject({ op: z.literal("deleteNote"), id: NoteIdSchema }),
  z.strictObject({ op: z.literal("removeFrame"), artifactId: z.uuid() }),
  z.strictObject({ op: z.literal("setLaunch"), launch: LaunchSchema }),
]);
export type BoardOp = z.infer<typeof BoardOpSchema>;

// ── Anchors ─────────────────────────────────────────────────────────────────

/**
 * Where a thread points. `x` and `y` are normalized to the viewer's box where
 * bounded to [0, 1]; a `doc` anchor stores the document-space `y` and the
 * `docWidth` it was measured at; `board` coordinates are board-space.
 */
export const AnchorSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("general") }),
  z.strictObject({
    type: z.literal("board"),
    page: PageIndex,
    x: Coordinate,
    y: Coordinate,
  }),
  z.strictObject({ type: z.literal("frame"), x: Unit, y: Unit }),
  z.strictObject({
    type: z.literal("doc"),
    path: ArtifactPathSchema,
    x: Unit,
    y: z.number().min(0),
    docWidth: z.number().positive(),
  }),
  z.strictObject({
    type: z.literal("page"),
    page: z.number().int().min(1),
    x: Unit,
    y: Unit,
  }),
  z.strictObject({
    type: z.literal("time"),
    t: z.number().min(0),
    x: Unit.optional(),
    y: Unit.optional(),
  }),
]);
export type Anchor = z.infer<typeof AnchorSchema>;

// ── Upload ──────────────────────────────────────────────────────────────────

export const ViewportSchema = z.strictObject({
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});
export type Viewport = z.infer<typeof ViewportSchema>;

export const UploadFileSchema = z.strictObject({
  path: ArtifactPathSchema,
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: Sha256Schema,
  mediaType: z.string().min(1).max(200),
});
export type UploadFile = z.infer<typeof UploadFileSchema>;

/**
 * The manifest of one version. Re-sending the same `idempotencyKey` with the
 * same request resumes the upload; `expectedCurrentVersionId` is the
 * compare-and-set token (null when the artifact has no version yet).
 */
export const CreateUploadRequestSchema = z
  .strictObject({
    board: BoardSlugSchema,
    artifactId: z.uuid().optional(),
    title: z.string().trim().min(1).max(200),
    kind: ArtifactKindSchema.optional(),
    entryPath: ArtifactPathSchema,
    note: z.string().max(10_000).optional(),
    /** Titles a board created by this upload; defaults to the slug. */
    boardTitle: z.string().trim().min(1).max(200).optional(),
    viewport: ViewportSchema.optional(),
    placement: z
      .strictObject({ w: Size, h: Size, rightOf: z.uuid().optional() })
      .optional(),
    idempotencyKey: IdempotencyKeySchema,
    expectedCurrentVersionId: z.uuid().nullable(),
    files: z.array(UploadFileSchema).min(1).max(MAX_MANIFEST_FILES),
  })
  .superRefine((request, context) => {
    const paths = new Set<string>();
    for (const [position, file] of request.files.entries()) {
      if (paths.has(file.path))
        context.addIssue({
          code: "custom",
          path: ["files", position, "path"],
          message: "duplicate path",
        });
      paths.add(file.path);
    }
    if (!paths.has(request.entryPath))
      context.addIssue({
        code: "custom",
        path: ["entryPath"],
        message: "entryPath is not in files",
      });
  });
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

export const CreateUploadResponseSchema = z.strictObject({
  uploadId: z.uuid(),
  /** Digests the service does not hold yet; only these need a `PUT`. */
  missing: z.array(Sha256Schema),
  expiresAt: Timestamp,
  /** True when the key already committed: nothing to upload; commit returns it. */
  deduplicated: z.boolean(),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

export const CommitUploadResponseSchema = z.strictObject({
  artifactId: z.uuid(),
  versionId: z.uuid(),
  number: z.number().int().min(1),
  reviewUrl: z.url(),
  boardUrl: z.url(),
  /** True when this returns an earlier committed result for the same key. */
  deduplicated: z.boolean(),
});
export type CommitUploadResponse = z.infer<typeof CommitUploadResponseSchema>;

// ── Feedback ────────────────────────────────────────────────────────────────

export const ThreadStateSchema = z.enum(["open", "resolved"]);
export type ThreadState = z.infer<typeof ThreadStateSchema>;

const CommentViewSchema = z.strictObject({
  id: z.uuid(),
  body: z.string(),
  author: ActorRefSchema,
  createdAt: Timestamp,
});
export type CommentView = z.infer<typeof CommentViewSchema>;

/**
 * One undelivered human comment. `artifact` is null for a thread pinned to a
 * board rather than to an artifact; `commentedOnVersion` is null for a thread
 * that is not tied to one version.
 */
export const FeedbackItemSchema = z.strictObject({
  comment: CommentViewSchema,
  attempt: z.number().int().min(1),
  thread: z.strictObject({
    id: z.uuid(),
    anchor: AnchorSchema,
    state: ThreadStateSchema,
    priorComments: z.array(CommentViewSchema),
  }),
  artifact: z
    .strictObject({
      id: z.uuid(),
      title: z.string(),
      commentedOnVersion: z.number().int().min(1).nullable(),
      currentVersion: z.number().int().min(1),
    })
    .nullable(),
  reviewUrl: z.url(),
});
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;

/** What a `wait` or a stream covers: the caller's own artifacts by default. */
export const FeedbackScopeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("owner"), ownerKey: z.string().min(1) }),
  z.strictObject({ type: z.literal("board"), board: BoardSlugSchema }),
  z.strictObject({ type: z.literal("artifact"), artifactId: z.uuid() }),
]);
export type FeedbackScope = z.infer<typeof FeedbackScopeSchema>;

export const FeedbackClaimResponseSchema = z.strictObject({
  items: z.array(FeedbackItemSchema),
  /** When the next comment still in its settle window becomes deliverable. */
  nextDeliverableAt: Timestamp.nullable(),
});
export type FeedbackClaimResponse = z.infer<typeof FeedbackClaimResponseSchema>;

/**
 * Server-sent messages of the live stream. They only wake a client: ids and
 * counters, never a content token, comment body or path.
 */
export const LiveMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ready"),
    scope: FeedbackScopeSchema,
    pending: z.number().int().min(0),
  }),
  z.strictObject({
    type: z.literal("feedback"),
    boardId: z.uuid(),
    artifactId: z.uuid().nullable(),
    threadId: z.uuid(),
    commentId: z.uuid(),
    deliverableAt: Timestamp,
  }),
  z.strictObject({
    type: z.literal("board"),
    boardId: z.uuid(),
    revision: z.number().int().min(1),
  }),
  /**
   * UI stream only: something changed on a board; refetch what you show.
   * `seq` is the change log position, or null for a change that is not in
   * the log (kind `waiter`: an agent's feedback stream connected or closed).
   */
  z.strictObject({
    type: z.literal("change"),
    boardId: z.uuid().nullable(),
    kind: z.string().min(1).max(100),
    entityId: z.string().min(1).max(100),
    seq: z.number().int().min(1).nullable(),
  }),
  z.strictObject({ type: z.literal("resync") }),
  z.strictObject({ type: z.literal("gone") }),
]);
export type LiveMessage = z.infer<typeof LiveMessageSchema>;

/** The tRPC router type; `maintenance.*` is served on the internal host only. */
export type AppRouter = ServerRouter & { readonly __wireContract?: never };
