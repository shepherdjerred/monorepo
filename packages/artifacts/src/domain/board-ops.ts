import {
  BoardIndexSchema,
  type BoardIndex,
  type BoardOp,
  type Frame,
} from "#shared/contract.ts";

/** Space between a placed frame and its neighbour, in board units. */
export const FRAME_GAP = 40;

function without(order: string[], id: string): string[] {
  return order.filter((entry) => entry !== id);
}

function rightEdge(frames: Record<string, Frame>, page: number) {
  let edge: number | undefined;
  let top: number | undefined;
  for (const frame of Object.values(frames)) {
    if (frame.page !== page) continue;
    edge = Math.max(edge ?? Number.NEGATIVE_INFINITY, frame.x + frame.w);
    top = Math.min(top ?? Number.POSITIVE_INFINITY, frame.y);
  }
  return { edge, top };
}

function place(index: BoardIndex, op: Extract<BoardOp, { op: "placeFrame" }>) {
  if (op.artifactId in index.frames) return index;
  const anchor =
    op.rightOf === undefined ? undefined : index.frames[op.rightOf];
  const start =
    anchor === undefined
      ? rightEdge(index.frames, 0)
      : { edge: anchor.x + anchor.w, top: anchor.y };
  const frame: Frame = {
    page: anchor?.page ?? 0,
    x: start.edge === undefined ? 0 : start.edge + FRAME_GAP,
    y: start.top ?? 0,
    w: op.w,
    h: op.h,
  };
  return {
    ...index,
    frames: { ...index.frames, [op.artifactId]: frame },
    order: [...index.order, op.artifactId],
  };
}

function move(index: BoardIndex, op: Extract<BoardOp, { op: "moveFrames" }>) {
  const frames = { ...index.frames };
  for (const step of op.moves) {
    const frame = frames[step.artifactId];
    if (frame === undefined) continue;
    const page =
      step.page !== undefined && step.page < index.pages.length
        ? step.page
        : frame.page;
    frames[step.artifactId] = {
      ...frame,
      x: step.x,
      y: step.y,
      page,
      w: step.w ?? frame.w,
      h: step.h ?? frame.h,
    };
  }
  return { ...index, frames };
}

function reorder(index: BoardIndex, requested: string[]) {
  const known = new Set(index.order);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of requested) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const id of index.order) if (!seen.has(id)) order.push(id);
  return { ...index, order };
}

function putNote(
  index: BoardIndex,
  op: Extract<BoardOp, { op: "putNote" }>,
): BoardIndex {
  if (op.id in index.frames) return index;
  const page = Math.min(op.note.page, index.pages.length - 1);
  return {
    ...index,
    notes: { ...index.notes, [op.id]: { ...op.note, page } },
    order: index.order.includes(op.id) ? index.order : [...index.order, op.id],
  };
}

function removeFrame(index: BoardIndex, artifactId: string): BoardIndex {
  const { [artifactId]: _removed, ...frames } = index.frames;
  const launch =
    index.launch.artifactId === artifactId
      ? { view: index.launch.view }
      : index.launch;
  return { ...index, frames, order: without(index.order, artifactId), launch };
}

function applyOne(index: BoardIndex, op: BoardOp): BoardIndex {
  switch (op.op) {
    case "placeFrame":
      return place(index, op);
    case "moveFrames":
      return move(index, op);
    case "reorder":
      return reorder(index, op.order);
    case "putNote":
      return putNote(index, op);
    case "deleteNote": {
      const { [op.id]: _removed, ...notes } = index.notes;
      return { ...index, notes, order: without(index.order, op.id) };
    }
    case "removeFrame":
      return removeFrame(index, op.artifactId);
    case "setLaunch":
      return {
        ...index,
        launch:
          op.launch.artifactId === undefined ||
          op.launch.artifactId in index.frames
            ? op.launch
            : { view: op.launch.view },
      };
  }
}

/**
 * Merges operations into a board index, in order. An operation that names
 * something the board no longer holds is skipped rather than refused: a drag
 * and an agent publish must never reject each other.
 */
export function applyBoardOps(index: BoardIndex, ops: BoardOp[]): BoardIndex {
  let next = index;
  for (const op of ops) next = applyOne(next, op);
  return BoardIndexSchema.parse(next);
}
