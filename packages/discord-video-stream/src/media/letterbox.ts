/** Round to the nearest even integer (ties round up). h264 yuv420p requires even dimensions. */
function even(n: number): number {
  return Math.round(n / 2) * 2;
}

export type Box = { width: number; height: number };
export type Letterbox = { content: Box; canvas: Box };

/**
 * Compute a 16:9 output canvas and the centered, aspect-correct content box for a
 * source whose frames *display* at `displayAspect` (width / height). Pair with
 * prepareStream's `pad`: scale the source to `content` and pad it onto the black
 * `canvas`, so e.g. 4:3 or 3:2 content becomes a pillarboxed 16:9 stream without
 * stretching. Both content and canvas dimensions are even so the yuv420p encode is valid.
 */
export function computeLetterbox(
  displayAspect: number,
  canvasHeight: number,
): Letterbox {
  const ch = even(canvasHeight);
  const canvas = { width: even((ch * 16) / 9), height: ch };
  return { content: fitWithin(displayAspect, canvas), canvas };
}

/**
 * The largest even-dimensioned box with `displayAspect` (width / height) that fits inside `bounds`:
 * height-limited when the content is narrower than the bounds (pillarbox shape), width-limited when
 * wider (letterbox shape). Encode at this size and the picture keeps its shape without padding; a
 * player that receives a non-16:9 stream letterboxes it itself.
 */
export function fitWithin(displayAspect: number, bounds: Box): Box {
  if (!Number.isFinite(displayAspect) || displayAspect <= 0)
    throw new RangeError(
      `displayAspect must be positive, got ${displayAspect}`,
    );
  const bw = Math.max(2, Math.floor(bounds.width / 2) * 2);
  const bh = Math.max(2, Math.floor(bounds.height / 2) * 2);
  let h = bh;
  let w = even(h * displayAspect);
  if (w > bw) {
    w = bw;
    h = even(w / displayAspect);
  }
  return {
    width: Math.max(2, Math.min(w, bw)),
    height: Math.max(2, Math.min(h, bh)),
  };
}
