import type { ScreenMode } from "#src/emulator/mk64-state.ts";
import { drawHudOverlay } from "#src/stream/overlay.ts";
import type { NameOverlay } from "./name-overlay.ts";

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
  /** The engine's FrameFormat.rowScale; see engine/format.ts. */
  rowScale: number;
  nameOverlay: NameOverlay | undefined;
};

/** Pixel size of the frame being composited. */
export type FrameSize = { readonly width: number; readonly height: number };

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
 */
export function applyStreamOverlays(
  frame: Buffer,
  size: FrameSize,
  ctx: StreamOverlayContext,
): void {
  drawHudOverlay(
    frame,
    { width: size.width, rowScale: ctx.rowScale },
    ctx.epochMs,
    ctx.seatActivity,
  );
  ctx.nameOverlay?.apply(frame, size, ctx.mode, ctx.seats);
}
