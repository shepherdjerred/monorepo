import { describe, expect, it } from "vitest";
import {
  ACTOR_HEADER,
  ALLOWED_CDN_ORIGINS,
  ActorSchema,
  AnchorSchema,
  ArtifactKindSchema,
  BoardIndexSchema,
  BoardOpSchema,
  CommitUploadResponseSchema,
  CreateUploadRequestSchema,
  CreateUploadResponseSchema,
  EMPTY_BOARD_INDEX,
  FeedbackClaimResponseSchema,
  FeedbackItemSchema,
  InvalidArtifactPathError,
  LIMIT_DEFAULTS,
  LiveMessageSchema,
  WAIT_EXIT_CODES,
  normalizeArtifactPath,
} from "./contract.ts";

const ID = "0f6f1c8e-6a52-4b1c-9d57-3c2f1e8a7b10";
const OTHER_ID = "7d1d9a6c-2b3f-4e5a-8c9d-1a2b3c4d5e6f";
const SHA = "a".repeat(64);
const NOW = "2026-11-25T12:00:00.000Z";

describe("constants", () => {
  it("pins the header, exit codes, limits, and CDN origins", () => {
    expect(ACTOR_HEADER).toBe("X-Artifacts-Actor");
    expect(WAIT_EXIT_CODES).toEqual({ ok: 0, usage: 2, gone: 4, timeout: 6 });
    expect(LIMIT_DEFAULTS).toEqual({
      maxFileBytes: 524_288_000,
      maxVersionBytes: 1_073_741_824,
      maxFiles: 2000,
      feedbackSettleSeconds: 10,
      deliveryOrphanMinutes: 15,
      boardIdleDays: 90,
      archiveGraceDays: 7,
    });
    expect(ALLOWED_CDN_ORIGINS).toEqual([
      "https://cdn.jsdelivr.net",
      "https://cdnjs.cloudflare.com",
      "https://unpkg.com",
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ]);
  });
});

describe("ActorSchema", () => {
  // What `detectActor` in packages/toolkit/src/lib/tracker/actor.ts emits for a
  // Claude Code session: ActorSchema.parse drops undefined metadata keys.
  const toolkitActor = {
    key: "claude-code:559690d5-6098-45b6-b2e1-9ca79561c066",
    kind: "agent",
    name: "claude-code",
    metadata: {
      hostname: "karpathy",
      cwd: "/home/jerred/git/monorepo",
      branch: "artifacts-prepare",
      worktree: "/home/jerred/git/monorepo",
      repoHead: "50386dd5764b99f136cd12f31d1987fd9f6a6867",
      harness: "claude-code",
      sessionId: "559690d5-6098-45b6-b2e1-9ca79561c066",
      harnessVersion: "claude-code",
      executable: "/home/jerred/.local/bin/claude",
      model: "claude-sonnet-5-5",
      hcTerminal: "t-1",
      parentKey: "codex:abc",
      plan: "/home/jerred/.claude/plans/p.md",
    },
  };

  it("parses today's toolkit actor output unchanged", () => {
    expect(ActorSchema.parse(toolkitActor)).toEqual(toolkitActor);
  });

  it("parses a human actor with no metadata", () => {
    expect(
      ActorSchema.parse({ key: "human:jerred", kind: "human", name: "Jerred" }),
    ).toEqual({
      key: "human:jerred",
      kind: "human",
      name: "Jerred",
      metadata: {},
    });
  });

  it("accepts an optional workspaceKey", () => {
    const actor = ActorSchema.parse({
      ...toolkitActor,
      workspaceKey: "karpathy:/home/jerred/git/monorepo",
    });
    expect(actor.workspaceKey).toBe("karpathy:/home/jerred/git/monorepo");
  });

  it("rejects malformed keys, unknown kinds, blank names, and unknown fields", () => {
    expect(() =>
      ActorSchema.parse({ ...toolkitActor, key: "Bad Key" }),
    ).toThrow();
    expect(() =>
      ActorSchema.parse({ ...toolkitActor, key: "nocolon" }),
    ).toThrow();
    expect(() => ActorSchema.parse({ ...toolkitActor, kind: "bot" })).toThrow();
    expect(() => ActorSchema.parse({ ...toolkitActor, name: "  " })).toThrow();
    expect(() => ActorSchema.parse({ ...toolkitActor, extra: 1 })).toThrow();
    expect(() =>
      ActorSchema.parse({ ...toolkitActor, metadata: { unknown: "x" } }),
    ).toThrow();
    expect(() =>
      ActorSchema.parse({ ...toolkitActor, workspaceKey: "" }),
    ).toThrow();
  });
});

describe("ArtifactKindSchema", () => {
  it("accepts the nine kinds and rejects others", () => {
    for (const kind of [
      "html",
      "site",
      "image",
      "video",
      "pdf",
      "markdown",
      "cast",
      "mermaid",
      "file",
    ])
      expect(ArtifactKindSchema.parse(kind)).toBe(kind);
    expect(() => ArtifactKindSchema.parse("audio")).toThrow();
    expect(() => ArtifactKindSchema.parse("HTML")).toThrow();
  });
});

describe("normalizeArtifactPath", () => {
  it("returns a plain relative path unchanged", () => {
    expect(normalizeArtifactPath("index.html")).toBe("index.html");
    expect(normalizeArtifactPath("assets/app.v2/main..js")).toBe(
      "assets/app.v2/main..js",
    );
    expect(normalizeArtifactPath("a/_inner/b")).toBe("a/_inner/b");
  });

  it("normalizes to NFC and is idempotent", () => {
    const decomposed = "cafe\u{301}.html";
    const normalized = normalizeArtifactPath(decomposed);
    expect(normalized).toBe("caf\u{E9}.html");
    expect(normalizeArtifactPath(normalized)).toBe(normalized);
  });

  it.each([
    ["empty", ""],
    ["parent segment", "../etc/passwd"],
    ["embedded parent segment", "a/../b"],
    ["trailing parent segment", "a/.."],
    ["current-directory segment", "a/./b"],
    ["backslash", String.raw`a\b`],
    ["NUL", "a\u0000b"],
    ["control character", "a\nb"],
    ["leading slash", "/index.html"],
    ["leading underscore", "_t/token/index.html"],
    ["empty segment", "a//b"],
    ["trailing slash", "a/"],
  ])("rejects %s", (_name, path) => {
    expect(() => normalizeArtifactPath(path)).toThrow(InvalidArtifactPathError);
  });

  it("limits a path to 512 UTF-8 bytes, not characters", () => {
    expect(normalizeArtifactPath("a".repeat(512))).toHaveLength(512);
    expect(() => normalizeArtifactPath("a".repeat(513))).toThrow(
      InvalidArtifactPathError,
    );
    expect(normalizeArtifactPath("é".repeat(256))).toHaveLength(256);
    expect(() => normalizeArtifactPath("é".repeat(257))).toThrow(
      InvalidArtifactPathError,
    );
  });
});

const frame = { page: 0, x: 0, y: 0, w: 1440, h: 900 };
const board = {
  schema: 1,
  launch: { view: "canvas", artifactId: ID },
  pages: [{ name: "Concepts" }],
  frames: { [ID]: frame },
  order: [ID, "n1"],
  notes: {
    n1: { type: "sticky", page: 0, x: 5, y: 5, w: 100, h: 80, text: "hi" },
  },
};

describe("BoardIndexSchema", () => {
  it("accepts a full index and the empty index", () => {
    expect(BoardIndexSchema.parse(board).frames[ID]).toEqual(frame);
    expect(BoardIndexSchema.parse(EMPTY_BOARD_INDEX)).toEqual(
      EMPTY_BOARD_INDEX,
    );
  });

  it("accepts each note type", () => {
    const notes = {
      s: { type: "sticky", page: 0, x: 0, y: 0, w: 1, h: 1, text: "" },
      t: { type: "title", page: 0, x: 0, y: 0, text: "T" },
      b: { type: "box", page: 0, x: 0, y: 0, w: 1, h: 1 },
      l: { type: "line", page: 0, x: 0, y: 0, x2: 4, y2: 4 },
      a: { type: "arrow", page: 0, x: 0, y: 0, x2: 4, y2: 4 },
    };
    const parsed = BoardIndexSchema.parse({ ...board, order: [], notes });
    expect(parsed.notes["t"]).toMatchObject({ type: "title", size: "m" });
  });

  it("rejects a wrong schema version, no pages, and unknown fields", () => {
    expect(() => BoardIndexSchema.parse({ ...board, schema: 2 })).toThrow();
    expect(() => BoardIndexSchema.parse({ ...board, pages: [] })).toThrow();
    expect(() => BoardIndexSchema.parse({ ...board, extra: 1 })).toThrow();
    expect(() =>
      BoardIndexSchema.parse({ ...board, launch: { view: "grid" } }),
    ).toThrow();
  });

  it("rejects frames keyed by a non-uuid and degenerate frame sizes", () => {
    expect(() =>
      BoardIndexSchema.parse({ ...board, frames: { nope: frame }, order: [] }),
    ).toThrow();
    expect(() =>
      BoardIndexSchema.parse({
        ...board,
        frames: { [ID]: { ...frame, w: 0 } },
      }),
    ).toThrow();
    expect(() =>
      BoardIndexSchema.parse({
        ...board,
        frames: { [ID]: { ...frame, x: Number.POSITIVE_INFINITY } },
      }),
    ).toThrow();
  });

  it("rejects a page outside pages, a duplicate or dangling order entry, and a bad note", () => {
    expect(() =>
      BoardIndexSchema.parse({
        ...board,
        frames: { [ID]: { ...frame, page: 1 } },
      }),
    ).toThrow();
    expect(() =>
      BoardIndexSchema.parse({ ...board, order: [ID, ID] }),
    ).toThrow();
    expect(() =>
      BoardIndexSchema.parse({ ...board, order: [OTHER_ID] }),
    ).toThrow();
    expect(() =>
      BoardIndexSchema.parse({
        ...board,
        notes: { n1: { type: "circle", page: 0, x: 0, y: 0 } },
      }),
    ).toThrow();
    expect(() =>
      BoardIndexSchema.parse({
        ...board,
        notes: { n1: { type: "box", page: 0, x: 0, y: 0, w: -1, h: 1 } },
      }),
    ).toThrow();
  });
});

describe("BoardOpSchema", () => {
  it("accepts each operation", () => {
    const ops = [
      { op: "placeFrame", artifactId: ID, w: 1440, h: 900 },
      { op: "placeFrame", artifactId: ID, w: 1, h: 1, rightOf: OTHER_ID },
      { op: "moveFrames", moves: [{ artifactId: ID, x: 1, y: 2 }] },
      { op: "reorder", order: [ID, "n1"] },
      { op: "putNote", id: "n1", note: board.notes.n1 },
      { op: "deleteNote", id: "n1" },
      { op: "removeFrame", artifactId: ID },
      { op: "setLaunch", launch: { view: "focused", artifactId: ID } },
    ];
    for (const op of ops) expect(BoardOpSchema.parse(op).op).toBe(op.op);
  });

  it("rejects unknown ops, empty moves, bad ids, and extra fields", () => {
    expect(() => BoardOpSchema.parse({ op: "explode" })).toThrow();
    expect(() =>
      BoardOpSchema.parse({ op: "moveFrames", moves: [] }),
    ).toThrow();
    expect(() =>
      BoardOpSchema.parse({ op: "removeFrame", artifactId: "x" }),
    ).toThrow();
    expect(() =>
      BoardOpSchema.parse({ op: "placeFrame", artifactId: ID, w: 0, h: 1 }),
    ).toThrow();
    expect(() =>
      BoardOpSchema.parse({ op: "deleteNote", id: "has space" }),
    ).toThrow();
    expect(() =>
      BoardOpSchema.parse({ op: "removeFrame", artifactId: ID, extra: 1 }),
    ).toThrow();
  });
});

describe("AnchorSchema", () => {
  it("accepts every anchor type at its boundaries", () => {
    const anchors = [
      { type: "general" },
      { type: "board", page: 0, x: -50, y: 1e6 },
      { type: "frame", x: 0, y: 1 },
      { type: "doc", path: "docs/a.md", x: 0.5, y: 12_000, docWidth: 800 },
      { type: "page", page: 1, x: 0, y: 1 },
      { type: "time", t: 0 },
      { type: "time", t: 61.5, x: 0.2, y: 0.9 },
    ];
    for (const anchor of anchors)
      expect(AnchorSchema.parse(anchor)).toEqual(anchor);
  });

  it("rejects out-of-range and malformed anchors", () => {
    const bad = [
      { type: "pin" },
      { type: "frame", x: 1.01, y: 0 },
      { type: "frame", x: 0, y: -0.01 },
      { type: "doc", path: "a.md", x: 1.5, y: 0, docWidth: 800 },
      { type: "doc", path: "a.md", x: 0.5, y: -1, docWidth: 800 },
      { type: "doc", path: "a.md", x: 0.5, y: 0, docWidth: 0 },
      { type: "doc", path: "../a.md", x: 0.5, y: 0, docWidth: 800 },
      { type: "page", page: 0, x: 0, y: 0 },
      { type: "page", page: 1.5, x: 0, y: 0 },
      { type: "page", page: 1, x: 2, y: 0 },
      { type: "time", t: -1 },
      { type: "time", t: 1, x: 2 },
      { type: "board", x: 0, y: 0 },
      { type: "general", x: 0 },
    ];
    for (const anchor of bad)
      expect(() => AnchorSchema.parse(anchor)).toThrow();
  });
});

const upload = {
  board: "concepts",
  title: "Landing page",
  entryPath: "index.html",
  idempotencyKey: "k".repeat(20),
  expectedCurrentVersionId: null,
  files: [
    { path: "index.html", size: 120, sha256: SHA, mediaType: "text/html" },
    {
      path: "app.js",
      size: 0,
      sha256: "b".repeat(64),
      mediaType: "text/javascript",
    },
  ],
};

describe("CreateUploadRequestSchema", () => {
  it("accepts a minimal and a complete request", () => {
    expect(CreateUploadRequestSchema.parse(upload).files).toHaveLength(2);
    const full = CreateUploadRequestSchema.parse({
      ...upload,
      artifactId: ID,
      kind: "site",
      note: "Concept A",
      viewport: { width: 1440, height: 900 },
      placement: { w: 1440, h: 900, rightOf: OTHER_ID },
      expectedCurrentVersionId: OTHER_ID,
    });
    expect(full.kind).toBe("site");
  });

  it("requires expectedCurrentVersionId to be present, even when null", () => {
    const { expectedCurrentVersionId: _omitted, ...without } = upload;
    expect(() => CreateUploadRequestSchema.parse(without)).toThrow();
  });

  it("rejects bad slugs, keys, digests, paths, and sizes", () => {
    const bad = [
      { ...upload, board: "Has Caps" },
      { ...upload, board: "" },
      { ...upload, title: "   " },
      { ...upload, idempotencyKey: "short" },
      { ...upload, kind: "audio" },
      { ...upload, files: [] },
      { ...upload, files: [{ ...upload.files[0], sha256: "A".repeat(64) }] },
      { ...upload, files: [{ ...upload.files[0], sha256: "a".repeat(63) }] },
      { ...upload, files: [{ ...upload.files[0], size: -1 }] },
      { ...upload, files: [{ ...upload.files[0], size: 1.5 }] },
      { ...upload, files: [{ ...upload.files[0], path: "../x" }] },
      { ...upload, files: [{ ...upload.files[0], path: "_t/x" }] },
      { ...upload, viewport: { width: 0, height: 900 } },
      { ...upload, extra: true },
    ];
    for (const request of bad)
      expect(() => CreateUploadRequestSchema.parse(request)).toThrow();
  });

  it("rejects duplicate paths and an entry path outside the manifest", () => {
    expect(() =>
      CreateUploadRequestSchema.parse({
        ...upload,
        files: [upload.files[0], upload.files[0]],
      }),
    ).toThrow();
    expect(() =>
      CreateUploadRequestSchema.parse({ ...upload, entryPath: "missing.html" }),
    ).toThrow();
  });

  it("rejects a path that is not already NFC", () => {
    expect(() =>
      CreateUploadRequestSchema.parse({
        ...upload,
        entryPath: "café.html",
        files: [{ ...upload.files[0], path: "café.html" }],
      }),
    ).toThrow();
  });

  it("leaves configurable limits to the server", () => {
    const huge = {
      ...upload,
      files: [{ ...upload.files[0], size: LIMIT_DEFAULTS.maxFileBytes + 1 }],
    };
    expect(CreateUploadRequestSchema.parse(huge).files[0]?.size).toBe(
      LIMIT_DEFAULTS.maxFileBytes + 1,
    );
  });
});

describe("upload responses", () => {
  it("accepts a create response", () => {
    const parsed = CreateUploadResponseSchema.parse({
      uploadId: ID,
      missing: [SHA],
      expiresAt: NOW,
    });
    expect(parsed.missing).toEqual([SHA]);
    expect(
      CreateUploadResponseSchema.parse({
        uploadId: ID,
        missing: [],
        expiresAt: NOW,
      }).missing,
    ).toEqual([]);
  });

  it("rejects a create response with a bad digest, id, or date", () => {
    expect(() =>
      CreateUploadResponseSchema.parse({
        uploadId: ID,
        missing: ["x"],
        expiresAt: NOW,
      }),
    ).toThrow();
    expect(() =>
      CreateUploadResponseSchema.parse({
        uploadId: "x",
        missing: [],
        expiresAt: NOW,
      }),
    ).toThrow();
    expect(() =>
      CreateUploadResponseSchema.parse({
        uploadId: ID,
        missing: [],
        expiresAt: "tomorrow",
      }),
    ).toThrow();
  });

  it("accepts and rejects a commit response", () => {
    const commit = {
      artifactId: ID,
      versionId: OTHER_ID,
      number: 1,
      reviewUrl: "https://artifacts.tailnet-1a49.ts.net/a/x?v=1",
      boardUrl: "https://artifacts.tailnet-1a49.ts.net/b/concepts",
    };
    expect(CommitUploadResponseSchema.parse(commit)).toEqual(commit);
    expect(() =>
      CommitUploadResponseSchema.parse({ ...commit, number: 0 }),
    ).toThrow();
    expect(() =>
      CommitUploadResponseSchema.parse({ ...commit, reviewUrl: "/a/x" }),
    ).toThrow();
  });
});

const author = { key: "human:jerred", kind: "human", name: "Jerred" };
const comment = { id: ID, body: "Make it blue", author, createdAt: NOW };
const item = {
  comment,
  attempt: 1,
  thread: {
    id: OTHER_ID,
    anchor: { type: "frame", x: 0.4, y: 0.6 },
    state: "open",
    priorComments: [],
  },
  artifact: {
    id: ID,
    title: "Concept A",
    commentedOnVersion: 1,
    currentVersion: 2,
  },
  reviewUrl: "https://artifacts.tailnet-1a49.ts.net/a/x?v=1",
};

describe("FeedbackItemSchema and claim response", () => {
  it("accepts an item, a board thread with no artifact, and prior comments", () => {
    expect(FeedbackItemSchema.parse(item).artifact?.currentVersion).toBe(2);
    expect(
      FeedbackItemSchema.parse({ ...item, artifact: null }).artifact,
    ).toBeNull();
    const withPrior = FeedbackItemSchema.parse({
      ...item,
      thread: { ...item.thread, priorComments: [comment] },
    });
    expect(withPrior.thread.priorComments).toHaveLength(1);
    expect(
      FeedbackItemSchema.parse({
        ...item,
        artifact: { ...item.artifact, commentedOnVersion: null },
      }).artifact?.commentedOnVersion,
    ).toBeNull();
  });

  it("rejects attempt 0, an unknown thread state, and a missing reviewUrl", () => {
    expect(() => FeedbackItemSchema.parse({ ...item, attempt: 0 })).toThrow();
    expect(() =>
      FeedbackItemSchema.parse({
        ...item,
        thread: { ...item.thread, state: "closed" },
      }),
    ).toThrow();
    const { reviewUrl: _omitted, ...without } = item;
    expect(() => FeedbackItemSchema.parse(without)).toThrow();
    expect(() =>
      FeedbackItemSchema.parse({
        ...item,
        thread: { ...item.thread, anchor: { type: "frame", x: 2, y: 0 } },
      }),
    ).toThrow();
  });

  it("accepts a claim with items and a null next deliverable time", () => {
    expect(
      FeedbackClaimResponseSchema.parse({
        items: [item],
        nextDeliverableAt: null,
      }).items,
    ).toHaveLength(1);
    expect(
      FeedbackClaimResponseSchema.parse({ items: [], nextDeliverableAt: NOW })
        .nextDeliverableAt,
    ).toBe(NOW);
  });

  it("requires nextDeliverableAt", () => {
    expect(() => FeedbackClaimResponseSchema.parse({ items: [] })).toThrow();
  });
});

describe("LiveMessageSchema", () => {
  it("accepts every message type", () => {
    const messages = [
      {
        type: "ready",
        scope: { type: "board", board: "concepts" },
        pending: 0,
      },
      {
        type: "ready",
        scope: { type: "owner", ownerKey: "karpathy:/w" },
        pending: 3,
      },
      {
        type: "feedback",
        boardId: ID,
        artifactId: OTHER_ID,
        threadId: ID,
        commentId: OTHER_ID,
        deliverableAt: NOW,
      },
      {
        type: "feedback",
        boardId: ID,
        artifactId: null,
        threadId: ID,
        commentId: OTHER_ID,
        deliverableAt: NOW,
      },
      { type: "board", boardId: ID, revision: 7 },
      { type: "resync" },
      { type: "gone" },
    ];
    for (const message of messages)
      expect(LiveMessageSchema.parse(message)).toEqual(message);
  });

  it("rejects unknown types, negative counts, revision 0, and payload extras", () => {
    expect(() => LiveMessageSchema.parse({ type: "ping" })).toThrow();
    expect(() =>
      LiveMessageSchema.parse({
        type: "ready",
        scope: { type: "artifact", artifactId: ID },
        pending: -1,
      }),
    ).toThrow();
    expect(() =>
      LiveMessageSchema.parse({ type: "board", boardId: ID, revision: 0 }),
    ).toThrow();
    expect(() =>
      LiveMessageSchema.parse({ type: "resync", contentToken: "secret" }),
    ).toThrow();
    expect(() =>
      LiveMessageSchema.parse({
        type: "ready",
        scope: { type: "board", board: "Bad Slug" },
        pending: 0,
      }),
    ).toThrow();
  });
});
