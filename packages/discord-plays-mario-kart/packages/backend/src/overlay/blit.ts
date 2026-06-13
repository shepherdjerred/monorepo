/**
 * A pre-rendered label ready to alpha-blit onto a BGRA framebuffer.
 *
 * `bgra` holds premultiplied colour (B,G,R already multiplied by alpha) plus
 * the straight alpha in the 4th byte, so the per-pixel composite is a single
 * multiply-add — no division in the hot path.
 */
export type Label = {
  bgra: Buffer;
  width: number;
  height: number;
};

/** A BGRA framebuffer view: the pixel buffer plus its dimensions. */
export type FrameView = {
  data: Buffer;
  width: number;
  height: number;
};

/**
 * Alpha-blit a premultiplied BGRA label onto a BGRA framebuffer at (x, y),
 * clipped to the frame bounds. Pure and synchronous — safe in the frame loop.
 *
 *   out = label_premultiplied + dst * (1 - alpha)
 */
export function blitBgra(
  frame: FrameView,
  label: Label,
  x: number,
  y: number,
): void {
  const { data, width: frameW, height: frameH } = frame;
  const { bgra, width: lw, height: lh } = label;

  // Clip the label rectangle to the frame.
  const startX = Math.max(0, x);
  const startY = Math.max(0, y);
  const endX = Math.min(frameW, x + lw);
  const endY = Math.min(frameH, y + lh);
  if (endX <= startX || endY <= startY) return;

  for (let fy = startY; fy < endY; fy++) {
    const ly = fy - y;
    let fi = (fy * frameW + startX) * 4;
    let li = (ly * lw + (startX - x)) * 4;
    for (let fx = startX; fx < endX; fx++) {
      const a = bgra[li + 3] ?? 0;
      if (a === 255) {
        data[fi] = bgra[li] ?? 0;
        data[fi + 1] = bgra[li + 1] ?? 0;
        data[fi + 2] = bgra[li + 2] ?? 0;
        data[fi + 3] = 0xff; // match the HUD: opaque dead-alpha padding
      } else if (a !== 0) {
        const inv = 255 - a;
        // label channels are premultiplied; dst scaled by inverse alpha.
        data[fi] = (bgra[li] ?? 0) + (((data[fi] ?? 0) * inv) >> 8);
        data[fi + 1] = (bgra[li + 1] ?? 0) + (((data[fi + 1] ?? 0) * inv) >> 8);
        data[fi + 2] = (bgra[li + 2] ?? 0) + (((data[fi + 2] ?? 0) * inv) >> 8);
        data[fi + 3] = 0xff;
      }
      fi += 4;
      li += 4;
    }
  }
}
