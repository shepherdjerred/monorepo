import type { ScreenMode } from "#src/emulator/mk64-memory.ts";
import { drawHudOverlay } from "#src/stream/overlay.ts";
import type { NameOverlay } from "./name-overlay.ts";
import { WIDTH } from "#src/emulator/constants.ts";

/**
 * Per-frame overlay context. Shared between the Go-Live stream path and the
 * `/screenshot` (Discord + web) path so both render the same HUD clock + name
 * pills.
 */
export type StreamOverlayContext = {
  epochMs: number;
  seatActivity: readonly boolean[];
  mode: ScreenMode;
  seats: number;
  nameOverlay: NameOverlay | undefined;
};

/**
 * Resolves the live overlay context at screenshot time, so each call reads the
 * current mode + seat-activity flags. The provider itself is optional (absent →
 * screenshots stay clean); when present it always returns a real context.
 *
 * Defined here alongside `StreamOverlayContext` so that Discord command modules
 * and the webserver dispatch layer can both import it from the overlay layer
 * rather than reaching across into `webserver/dispatch.ts`.
 */
export type StreamOverlayContextProvider = () => StreamOverlayContext;

/**
 * Mutate `frame` (BGRA *or* RGBX — both overlays write greyscale, so channel
 * order is irrelevant) by drawing the HUD clock and seat-echo flags, then
 * blitting cached per-seat name pills.
 *
 * `width` is fixed at the framebuffer's 640 px; `height` varies per VI mode.
 */
export function applyStreamOverlays(
  frame: Buffer,
  height: number,
  ctx: StreamOverlayContext,
): void {
  drawHudOverlay(frame, WIDTH, ctx.epochMs, ctx.seatActivity);
  ctx.nameOverlay?.apply(frame, height, ctx.mode, ctx.seats);
}
