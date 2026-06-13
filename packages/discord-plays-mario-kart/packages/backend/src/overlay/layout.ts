import type { ScreenMode } from "#src/emulator/mk64-memory.ts";
import { WIDTH, HEIGHT } from "#src/emulator/constants.ts";

/** A rectangle in framebuffer pixel space (640 x height). */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Per-seat viewport rectangles for an MK64 screen mode, in 640x240 framebuffer
 * space. Index = seat (0..3); the returned array length is the number of
 * on-screen viewports for that mode.
 *
 * MK64 splits:
 * - 1p:            one fullscreen viewport.
 * - 2p horizontal: stacked top/bottom halves (P1 top, P2 bottom).
 * - 2p vertical:   side-by-side left/right halves (P1 left, P2 right).
 * - 3p/4p (quad):  four quadrants; in 3p the 4th quadrant shows the map, so
 *                  only seats 0..2 get a label position.
 */
export function viewportRects(
  mode: ScreenMode,
  seats: number,
  w: number = WIDTH,
  h: number = HEIGHT,
): Rect[] {
  const halfW = Math.floor(w / 2);
  const halfH = Math.floor(h / 2);
  switch (mode) {
    case "1p":
      return [{ x: 0, y: 0, w, h }];
    case "2p-horizontal":
      return [
        { x: 0, y: 0, w, h: halfH },
        { x: 0, y: halfH, w, h: halfH },
      ];
    case "2p-vertical":
      return [
        { x: 0, y: 0, w: halfW, h },
        { x: halfW, y: 0, w: halfW, h },
      ];
    case "quad": {
      const quads: Rect[] = [
        { x: 0, y: 0, w: halfW, h: halfH },
        { x: halfW, y: 0, w: halfW, h: halfH },
        { x: 0, y: halfH, w: halfW, h: halfH },
        { x: halfW, y: halfH, w: halfW, h: halfH },
      ];
      // 3 humans: the bottom-right quadrant is the shared map, not a viewport.
      return quads.slice(0, Math.max(seats, 3) >= 4 ? 4 : 3);
    }
  }
}

/**
 * Bottom-right anchor for a label inside a viewport, leaving a small margin.
 * Clamps so the label never starts off the left/top edge of a small viewport.
 */
export function labelPosition(
  viewport: Rect,
  label: { width: number; height: number },
  margin = 4,
): { x: number; y: number } {
  const x = viewport.x + viewport.w - label.width - margin;
  const y = viewport.y + viewport.h - label.height - margin;
  return {
    x: Math.max(viewport.x, x),
    y: Math.max(viewport.y, y),
  };
}

/**
 * Map a screen mode to the seat count it implies, used to decide which seats
 * have a visible viewport (and thus a label slot).
 */
export function seatsForMode(mode: ScreenMode): number {
  switch (mode) {
    case "1p":
      return 1;
    case "2p-horizontal":
    case "2p-vertical":
      return 2;
    case "quad":
      return 4;
  }
}
