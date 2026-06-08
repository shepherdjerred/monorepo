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
  const cw = even((ch * 16) / 9);

  // Fit the display-aspect box inside the canvas: height-limited when the content
  // is narrower than 16:9 (pillarbox), width-limited when wider (letterbox).
  let h = ch;
  let w = even(h * displayAspect);
  if (w > cw) {
    w = cw;
    h = even(w / displayAspect);
  }

  return {
    content: { width: Math.min(w, cw), height: Math.min(h, ch) },
    canvas: { width: cw, height: ch },
  };
}
