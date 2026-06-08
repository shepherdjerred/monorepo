/** Round to the nearest even integer (h264 yuv420p requires even dimensions). */
function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

export type Box = { width: number; height: number };
export type Letterbox = { content: Box; canvas: Box };

/**
 * Compute a 16:9 output canvas and the centered, aspect-correct content box for a
 * game whose frames *display* at `displayAspect` (width / height). The game is
 * scaled to the content box and padded onto a black 16:9 canvas (prepareStream's
 * `pad`), so e.g. 4:3 content becomes a pillarboxed 16:9 stream without stretching.
 *
 * Both content and canvas dimensions are forced even so the yuv420p encode is valid.
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
