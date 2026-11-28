/**
 * What the canvas draws, derived from one `boards.get` answer and the board's
 * threads. Pure, so reading order and pin selection are testable.
 */
import type { Anchor, BoardIndex } from "@shepherdjerred/artifacts/contract";
import type {
  ArtifactSummary,
  ThreadView,
} from "@shepherdjerred/artifacts/procedures";
import { isOtherVersion, isPlaced } from "#client/lib/pins.ts";
import type { WorldRect } from "./camera.ts";

export type CanvasFrameModel = {
  readonly id: string;
  readonly rect: WorldRect;
  /** The frame's position in `order`, back to front: its CSS z-index. */
  readonly z: number;
  readonly summary: ArtifactSummary;
};

/** The page the canvas shows; boards with several pages are out of scope. */
export const CANVAS_PAGE = 0;

/**
 * The frames of page 0 in a stable order (the order `boards.get` lists the
 * artifacts). The order must not change when a frame moves: the iframes are
 * rendered from this list, and moving an iframe in the DOM reloads it.
 */
export function frameModels(data: {
  readonly index: Pick<BoardIndex, "order" | "frames">;
  readonly artifacts: readonly ArtifactSummary[];
}): CanvasFrameModel[] {
  const { index, artifacts } = data;
  const stacking = new Map(index.order.map((id, position) => [id, position]));
  return artifacts.flatMap((summary) => {
    const frame = index.frames[summary.id];
    if (frame?.page !== CANVAS_PAGE) return [];
    return [
      {
        id: summary.id,
        rect: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
        z: stacking.get(summary.id) ?? 0,
        summary,
      },
    ];
  });
}

/**
 * Reading order: rows top to bottom, left to right inside a row. Frames whose
 * tops are within half the shortest height of the row's first frame share a row.
 */
export function readingOrder<T extends { readonly rect: WorldRect }>(
  frames: readonly T[],
): T[] {
  const byTop = [...frames].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x,
  );
  const rows: T[][] = [];
  for (const frame of byTop) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (
      row !== undefined &&
      first !== undefined &&
      frame.rect.y - first.rect.y < Math.min(first.rect.h, frame.rect.h) / 2
    )
      row.push(frame);
    else rows.push([frame]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.rect.x - b.rect.x));
}

export type CanvasPin = {
  readonly id: string;
  /** The thread's 1-based position among the board's threads. */
  readonly index: number;
  readonly anchor: Anchor;
  readonly state: "open" | "resolved";
  readonly stale: boolean;
  readonly versionNumber: number | null;
  /** The frame the anchor is inside, or null for a board pin. */
  readonly frameId: string | null;
};

/**
 * The world point of a placed board pin. A board comment made from the list
 * view or the sidebar is stored at the board origin: it is a comment on the
 * board, not a pin placed there, so it has no point.
 */
export function boardPoint(anchor: Anchor): { x: number; y: number } | null {
  return anchor.type === "board" && !(anchor.x === 0 && anchor.y === 0)
    ? { x: anchor.x, y: anchor.y }
    : null;
}

/** The pins to draw: board pins everywhere, frame pins on frames that exist. */
export function canvasPins(
  threads: readonly ThreadView[],
  frames: ReadonlyMap<string, CanvasFrameModel>,
): CanvasPin[] {
  return threads.flatMap((thread, position): CanvasPin[] => {
    const base = {
      id: thread.id,
      index: position + 1,
      anchor: thread.anchor,
      state: thread.state,
      versionNumber: thread.versionNumber,
    };
    if (boardPoint(thread.anchor) !== null)
      return [{ ...base, stale: false, frameId: null }];
    if (thread.artifactId === null || !isPlaced(thread.anchor)) return [];
    const frame = frames.get(thread.artifactId);
    if (frame === undefined) return [];
    return [
      {
        ...base,
        stale: isOtherVersion(
          thread.versionNumber,
          frame.summary.currentVersion?.number ?? null,
        ),
        frameId: frame.id,
      },
    ];
  });
}

/**
 * Width over height a resize keeps: the design viewport a frame was published
 * at, for kinds that render in a fixed viewport. Responsive frames and the
 * other kinds resize freely.
 */
export function fixedAspect(summary: ArtifactSummary): number | null {
  const viewport = summary.currentVersion?.viewport ?? null;
  const framed =
    summary.kind === "html" ||
    summary.kind === "site" ||
    summary.kind === "mermaid";
  return framed && viewport !== null ? viewport.width / viewport.height : null;
}

/**
 * The frames with a drag or resize in progress drawn at its live rectangle.
 * The draft is not part of the document: a change from elsewhere (an agent
 * publishing a frame) arrives underneath it and never disturbs the drag.
 */
export function applyDraft<
  T extends { readonly id: string; readonly rect: WorldRect },
>(
  models: readonly T[],
  draft: ReadonlyMap<string, WorldRect> | null,
): readonly T[] {
  if (draft === null) return models;
  return models.map((model) => {
    const rect = draft.get(model.id);
    return rect === undefined ? model : { ...model, rect };
  });
}
