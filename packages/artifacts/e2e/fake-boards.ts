/** Boards, artifacts and versions: serializers, the board-index operations and deletion. */
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import {
  BoardIndexSchema,
  EMPTY_BOARD_INDEX,
  LIMIT_DEFAULTS,
  type ArtifactKind,
  type BoardIndex,
  type BoardOp,
} from "#shared/contract.ts";
import type {
  ArtifactDetailSchema,
  ArtifactSummarySchema,
  BoardDocumentSchema,
  BoardSummarySchema,
  VersionSummarySchema,
  VersionViewSchema,
} from "#shared/procedures.ts";
import { emitChange } from "./fake-hub.ts";
import {
  badRequest,
  contentUrlOf,
  iso,
  notFound,
  type ArtifactRec,
  type BoardRec,
  type Store,
  type VersionRec,
} from "./fake-types.ts";

const DAY_MS = 86_400_000;
const FRAME_GAP = 40;

const DEFAULT_SIZE: Record<ArtifactKind, { w: number; h: number }> = {
  html: { w: 640, h: 420 },
  site: { w: 640, h: 420 },
  image: { w: 400, h: 300 },
  video: { w: 480, h: 270 },
  pdf: { w: 360, h: 480 },
  markdown: { w: 420, h: 520 },
  cast: { w: 560, h: 340 },
  mermaid: { w: 480, h: 360 },
  file: { w: 240, h: 120 },
};

export function defaultFrameSize(kind: ArtifactKind): { w: number; h: number } {
  return DEFAULT_SIZE[kind];
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export function boardBySlug(store: Store, slug: string): BoardRec | undefined {
  for (const board of store.boards.values())
    if (board.slug === slug) return board;
  return undefined;
}

export function requireBoard(store: Store, slug: string): BoardRec {
  const board = boardBySlug(store, slug);
  if (board === undefined) throw notFound(`board ${slug}`);
  return board;
}

export function requireArtifact(store: Store, id: string): ArtifactRec {
  const artifact = store.artifacts.get(id);
  if (artifact === undefined) throw notFound(`artifact ${id}`);
  return artifact;
}

export function requireVersion(store: Store, id: string): VersionRec {
  const version = store.versions.get(id);
  if (version === undefined) throw notFound(`version ${id}`);
  return version;
}

export function currentVersionOf(
  store: Store,
  artifact: ArtifactRec,
): VersionRec | null {
  return artifact.currentVersionId === null
    ? null
    : (store.versions.get(artifact.currentVersionId) ?? null);
}

export function boardMatchesState(
  board: BoardRec,
  state: "active" | "archived" | "kept" | "all",
): boolean {
  const matches = {
    active: board.archivedAt === null,
    archived: board.archivedAt !== null,
    kept: board.keep,
    all: true,
  };
  return matches[state];
}

export function createBoard(
  store: Store,
  slug: string,
  title: string,
): BoardRec {
  const now = store.options.now();
  const board: BoardRec = {
    id: crypto.randomUUID(),
    slug,
    title,
    index: structuredClone(EMPTY_BOARD_INDEX),
    revision: 1,
    keep: false,
    createdAt: now,
    lastActivityAt: now,
    archivedAt: null,
  };
  store.boards.set(board.id, board);
  emitChange(store, board.id, "board.created", board.id);
  return board;
}

export function bumpActivity(store: Store, board: BoardRec): void {
  board.lastActivityAt = store.options.now();
}

// ── Serializers ─────────────────────────────────────────────────────────────

export function artifactsOf(store: Store, board: BoardRec): ArtifactRec[] {
  return [...store.artifacts.values()].filter(
    (artifact) => artifact.boardId === board.id,
  );
}

export function summarizeBoard(
  store: Store,
  board: BoardRec,
): z.input<typeof BoardSummarySchema> {
  const blobs = new Map<string, number>();
  const artifacts = artifactsOf(store, board);
  for (const artifact of artifacts)
    for (const id of artifact.versionIds)
      for (const file of store.versions.get(id)?.files ?? [])
        blobs.set(file.sha256, file.size);
  let expiresAt: string | null = null;
  if (!board.keep) {
    expiresAt =
      board.archivedAt === null
        ? iso(board.lastActivityAt + LIMIT_DEFAULTS.boardIdleDays * DAY_MS)
        : iso(board.archivedAt + LIMIT_DEFAULTS.archiveGraceDays * DAY_MS);
  }
  return {
    id: board.id,
    slug: board.slug,
    title: board.title,
    revision: board.revision,
    keep: board.keep,
    createdAt: iso(board.createdAt),
    lastActivityAt: iso(board.lastActivityAt),
    archivedAt: board.archivedAt === null ? null : iso(board.archivedAt),
    expiredAt: null,
    expiresAt,
    artifactCount: artifacts.length,
    totalBytes: [...blobs.values()].reduce((sum, size) => sum + size, 0),
  };
}

export function documentOf(
  board: BoardRec,
): z.input<typeof BoardDocumentSchema> {
  return { revision: board.revision, index: structuredClone(board.index) };
}

function totalBytes(version: VersionRec): number {
  return version.files.reduce((sum, file) => sum + file.size, 0);
}

export function summarizeVersion(
  version: VersionRec,
): z.input<typeof VersionSummarySchema> {
  return {
    id: version.id,
    artifactId: version.artifactId,
    number: version.number,
    entryPath: version.entryPath,
    totalBytes: totalBytes(version),
    fileCount: version.files.length,
    note: version.note,
    viewport: version.viewport,
    createdAt: iso(version.createdAt),
    publisher: version.publisher,
    purged: false,
  };
}

export function viewVersion(
  store: Store,
  version: VersionRec,
): z.input<typeof VersionViewSchema> {
  return {
    ...summarizeVersion(version),
    contentUrl: contentUrlOf(store, version),
    files: version.files.map((file) => ({ ...file })),
  };
}

export function summarizeArtifact(
  store: Store,
  artifact: ArtifactRec,
): z.input<typeof ArtifactSummarySchema> {
  const board = store.boards.get(artifact.boardId);
  if (board === undefined) throw notFound(`board ${artifact.boardId}`);
  const current = currentVersionOf(store, artifact);
  const openThreadCount = [...store.threads.values()].filter(
    (thread) => thread.artifactId === artifact.id && thread.state === "open",
  ).length;
  return {
    id: artifact.id,
    boardId: board.id,
    boardSlug: board.slug,
    boardTitle: board.title,
    title: artifact.title,
    kind: artifact.kind,
    ownerKey: artifact.ownerKey,
    createdAt: iso(artifact.createdAt),
    versionCount: artifact.versionIds.length,
    openThreadCount,
    currentVersion: current === null ? null : summarizeVersion(current),
  };
}

export function detailArtifact(
  store: Store,
  artifact: ArtifactRec,
): z.input<typeof ArtifactDetailSchema> {
  const current = currentVersionOf(store, artifact);
  return {
    ...summarizeArtifact(store, artifact),
    current: current === null ? null : viewVersion(store, current),
  };
}

// ── Board index operations ──────────────────────────────────────────────────

function withoutId(index: BoardIndex, id: string): void {
  index.order = index.order.filter((entry) => entry !== id);
}

function framePosition(
  index: BoardIndex,
  rightOf: string | undefined,
): { page: number; x: number; y: number } {
  const anchor = rightOf === undefined ? undefined : index.frames[rightOf];
  if (anchor !== undefined)
    return {
      page: anchor.page,
      x: anchor.x + anchor.w + FRAME_GAP,
      y: anchor.y,
    };
  const onFirst = Object.values(index.frames).filter(
    (frame) => frame.page === 0,
  );
  return {
    page: 0,
    x: onFirst.reduce(
      (right, frame) => Math.max(right, frame.x + frame.w + FRAME_GAP),
      0,
    ),
    y: 0,
  };
}

function placeFrame(
  store: Store,
  index: BoardIndex,
  op: Extract<BoardOp, { op: "placeFrame" }>,
): void {
  if (!store.artifacts.has(op.artifactId))
    throw notFound(`artifact ${op.artifactId}`);
  if (op.artifactId in index.frames) return;
  index.frames[op.artifactId] = {
    ...framePosition(index, op.rightOf),
    w: op.w,
    h: op.h,
  };
  index.order.push(op.artifactId);
}

function moveFrames(
  index: BoardIndex,
  moves: Extract<BoardOp, { op: "moveFrames" }>["moves"],
): void {
  for (const move of moves) {
    const frame = index.frames[move.artifactId];
    if (frame === undefined) continue;
    frame.x = move.x;
    frame.y = move.y;
    if (move.page !== undefined) frame.page = move.page;
  }
}

function dropEntry(
  index: BoardIndex,
  kind: "frames" | "notes",
  id: string,
): void {
  index[kind] = Object.fromEntries(
    Object.entries(index[kind]).filter(([key]) => key !== id),
  );
  withoutId(index, id);
}

function reorder(index: BoardIndex, requested: readonly string[]): void {
  const known = new Set([
    ...Object.keys(index.frames),
    ...Object.keys(index.notes),
  ]);
  const next: string[] = [];
  for (const id of requested)
    if (known.has(id) && !next.includes(id)) next.push(id);
  for (const id of index.order) if (!next.includes(id)) next.push(id);
  index.order = next;
}

function applyOp(
  store: Store,
  board: BoardRec,
  index: BoardIndex,
  op: BoardOp,
): void {
  switch (op.op) {
    case "placeFrame":
      placeFrame(store, index, op);
      return;
    case "moveFrames":
      moveFrames(index, op.moves);
      return;
    case "reorder":
      reorder(index, op.order);
      return;
    case "putNote":
      index.notes[op.id] = op.note;
      if (!index.order.includes(op.id)) index.order.push(op.id);
      return;
    case "deleteNote":
      dropEntry(index, "notes", op.id);
      return;
    case "removeFrame":
      dropEntry(index, "frames", op.artifactId);
      return;
    case "setLaunch":
      if (op.launch.artifactId !== undefined) {
        const artifact = store.artifacts.get(op.launch.artifactId);
        if (artifact?.boardId !== board.id)
          throw badRequest("launch.artifactId is not on this board");
      }
      index.launch = op.launch;
      return;
  }
}

/** Replaces the stored index with an already validated one and wakes the streams. */
export function commitIndex(
  store: Store,
  board: BoardRec,
  index: BoardIndex,
): void {
  board.index = index;
  board.revision += 1;
  bumpActivity(store, board);
  emitChange(store, board.id, "board.index", String(board.revision));
}

/** Merges `ops` into the board; like the real `boards.apply` it is never refused on revision. */
export function applyOps(
  store: Store,
  board: BoardRec,
  ops: readonly BoardOp[],
): void {
  const index = structuredClone(board.index);
  for (const op of ops) applyOp(store, board, index, op);
  const checked = BoardIndexSchema.safeParse(index);
  if (!checked.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: checked.error.issues.map((issue) => issue.message).join("; "),
    });
  commitIndex(store, board, checked.data);
}

/** A whole-document replacement must only reference artifacts of the board. */
export function assertFramesOnBoard(
  store: Store,
  board: BoardRec,
  index: BoardIndex,
): void {
  for (const id of Object.keys(index.frames))
    if (store.artifacts.get(id)?.boardId !== board.id)
      throw badRequest(`frame ${id} is not an artifact of this board`);
}

export function deleteArtifact(store: Store, artifact: ArtifactRec): void {
  const board = store.boards.get(artifact.boardId);
  for (const id of artifact.versionIds) {
    const version = store.versions.get(id);
    if (version !== undefined) store.tokens.delete(version.token);
    store.versions.delete(id);
  }
  for (const [id, thread] of store.threads)
    if (thread.artifactId === artifact.id) store.threads.delete(id);
  store.artifacts.delete(artifact.id);
  if (board === undefined) return;
  const index = structuredClone(board.index);
  dropEntry(index, "frames", artifact.id);
  if (index.launch.artifactId === artifact.id)
    index.launch = { view: index.launch.view };
  commitIndex(store, board, index);
  emitChange(store, board.id, "artifact.deleted", artifact.id);
}
