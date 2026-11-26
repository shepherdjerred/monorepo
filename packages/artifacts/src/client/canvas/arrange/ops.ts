/**
 * Arrangement as board operations. A history entry records, for the frames an
 * edit touched, what each looked like before and after; undo and redo turn an
 * entry back into ops against whatever the board looks like now, so another
 * actor's frames are never disturbed.
 */
import type {
  BoardIndex,
  BoardOp,
  Frame,
} from "@shepherdjerred/artifacts/contract";
import type { Note } from "#client/canvas/notes/shapes.ts";

export type FrameChange = {
  readonly before: Frame | null;
  readonly after: Frame | null;
};

export type NoteChange = {
  readonly before: Note | null;
  readonly after: Note | null;
};

export type HistoryEntry = {
  readonly label: string;
  readonly frames: ReadonlyMap<string, FrameChange>;
  /** The annotations the edit touched. */
  readonly notes: ReadonlyMap<string, NoteChange>;
  /** The whole order before and after, when the edit changed it. */
  readonly order: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  } | null;
  /** Entries with the same key and close in time merge (a run of nudges is one undo). */
  readonly key: string | null;
  readonly at: number;
};

export function sameFrame(a: Frame | null, b: Frame | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.page === b.page &&
      a.x === b.x &&
      a.y === b.y &&
      a.w === b.w &&
      a.h === b.h)
  );
}

export function sameNote(a: Note | null, b: Note | null): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}

/**
 * The entry that turns `before` into `after` for the `touched` frames (and the
 * order, if it differs); null when nothing changed.
 */
export function entryBetween(edit: {
  readonly label: string;
  readonly before: BoardIndex;
  readonly after: BoardIndex;
  readonly touched: Iterable<string>;
  readonly key?: string;
  readonly at: number;
}): HistoryEntry | null {
  const { label, before, after, touched } = edit;
  const frames = new Map<string, FrameChange>();
  const notes = new Map<string, NoteChange>();
  for (const id of touched) {
    const change = {
      before: before.frames[id] ?? null,
      after: after.frames[id] ?? null,
    };
    if (!sameFrame(change.before, change.after)) frames.set(id, change);
    const noteChange = {
      before: before.notes[id] ?? null,
      after: after.notes[id] ?? null,
    };
    if (!sameNote(noteChange.before, noteChange.after))
      notes.set(id, noteChange);
  }
  const order = sameOrder(before.order, after.order)
    ? null
    : { before: before.order, after: after.order };
  return order === null && frames.size === 0 && notes.size === 0
    ? null
    : { label, frames, notes, order, key: edit.key ?? null, at: edit.at };
}

/** Merges two entries of one run: the first's before, the second's after. */
export function mergeEntries(
  first: HistoryEntry,
  second: HistoryEntry,
): HistoryEntry {
  const frames = new Map(first.frames);
  for (const [id, change] of second.frames) {
    const earlier = frames.get(id);
    frames.set(id, {
      before: earlier?.before ?? change.before,
      after: change.after,
    });
  }
  const notes = new Map(first.notes);
  for (const [id, change] of second.notes) {
    const earlier = notes.get(id);
    notes.set(id, {
      before: earlier === undefined ? change.before : earlier.before,
      after: change.after,
    });
  }
  return {
    label: second.label,
    frames,
    notes,
    order:
      first.order === null && second.order === null
        ? null
        : {
            before: first.order?.before ?? second.order?.before ?? [],
            after: second.order?.after ?? first.order?.after ?? [],
          },
    key: second.key,
    at: second.at,
  };
}

function moveOf(id: string, frame: Frame): BoardOp {
  return {
    op: "moveFrames",
    moves: [
      {
        artifactId: id,
        x: frame.x,
        y: frame.y,
        page: frame.page,
        w: frame.w,
        h: frame.h,
      },
    ],
  };
}

/**
 * Ops that put the touched frames (and the order) in the entry's `before`
 * (undo) or `after` (redo) state, given what the board is now.
 */
export function entryOps(
  entry: HistoryEntry,
  direction: "undo" | "redo",
  current: BoardIndex,
): BoardOp[] {
  const ops = [...entry.frames].flatMap(([id, change]) =>
    opsForFrame(
      id,
      direction === "undo" ? change.before : change.after,
      current,
    ),
  );
  for (const [id, change] of entry.notes)
    ops.push(
      ...opsForNote(
        id,
        direction === "undo" ? change.before : change.after,
        current,
      ),
    );
  if (entry.order !== null)
    ops.push({
      op: "reorder",
      order: [
        ...(direction === "undo" ? entry.order.before : entry.order.after),
      ],
    });
  return ops;
}

function opsForNote(
  id: string,
  target: Note | null,
  current: BoardIndex,
): BoardOp[] {
  const present = current.notes[id] ?? null;
  if (target === null)
    return present === null ? [] : [{ op: "deleteNote", id }];
  return sameNote(present, target) ? [] : [{ op: "putNote", id, note: target }];
}

function opsForFrame(
  id: string,
  target: Frame | null,
  current: BoardIndex,
): BoardOp[] {
  const present = current.frames[id];
  if (target === null)
    return present === undefined ? [] : [{ op: "removeFrame", artifactId: id }];
  if (present === undefined)
    return [
      { op: "placeFrame", artifactId: id, w: target.w, h: target.h },
      moveOf(id, target),
    ];
  return sameFrame(present, target) ? [] : [moveOf(id, target)];
}

/** The ops of a fresh edit: what it did, going forward. */
export function entryForward(
  entry: HistoryEntry,
  current: BoardIndex,
): BoardOp[] {
  return entryOps(entry, "redo", current);
}

const MAX_MOVES = 500;

/**
 * Folds adjacent operations of one kind: moves merge by frame (the later wins),
 * a later reorder replaces an earlier one. Only neighbours merge, so the
 * sequence's meaning is unchanged.
 */
export function coalesceOps(ops: readonly BoardOp[]): BoardOp[] {
  const out: BoardOp[] = [];
  for (const op of ops) {
    const merged = mergeInto(out.at(-1), op);
    if (merged === null) out.push(op);
    else out[out.length - 1] = merged;
  }
  return out;
}

/** `op` folded into the operation before it, or null when they do not merge. */
function mergeInto(last: BoardOp | undefined, op: BoardOp): BoardOp | null {
  if (last?.op === "moveFrames" && op.op === "moveFrames") {
    const merged = new Map(last.moves.map((move) => [move.artifactId, move]));
    for (const move of op.moves) merged.set(move.artifactId, move);
    return merged.size <= MAX_MOVES
      ? { op: "moveFrames", moves: [...merged.values()] }
      : null;
  }
  if (last?.op === "putNote" && op.op === "putNote" && last.id === op.id)
    return op;
  return last?.op === "reorder" && op.op === "reorder" ? op : null;
}
