import { logger } from "#src/logger.ts";
import { MAX_SEATS, WIDTH } from "#src/emulator/constants.ts";
import type { ScreenMode } from "#src/emulator/mk64-memory.ts";
import { blitBgra } from "./blit.ts";
import type { Label } from "./blit.ts";
import { labelPosition, viewportRects } from "./layout.ts";
import type { LabelRenderer } from "./label-renderer.ts";

type Slot = {
  /** The name currently rendered (or being rendered) into `label`. */
  name: string;
  /** Bumped on every setName; a resolved render commits only if it matches. */
  token: number;
  label: Label | undefined;
};

// Cap labels at the narrowest viewport (a quad cell = half width) so a label
// rendered once fits every screen mode without re-rendering on mode changes.
const MAX_LABEL_FRAME_WIDTH = Math.floor(WIDTH / 2);

/**
 * Owns the per-seat name labels burned into the stream. `setName` renders
 * asynchronously (off the frame loop) and atomically swaps the cached label;
 * `apply` is synchronous, allocation-free, and never throws — safe to call
 * every frame.
 */
export class NameOverlay {
  private readonly renderer: LabelRenderer;
  private readonly slots: (Slot | undefined)[] = Array.from<Slot | undefined>({
    length: MAX_SEATS,
  });

  constructor(renderer: LabelRenderer) {
    this.renderer = renderer;
  }

  /** Set or clear (null) the label for a seat. Idempotent for unchanged names. */
  setName(seat: number, name: string | null): void {
    if (seat < 0 || seat >= MAX_SEATS) return;

    if (name === null) {
      this.slots[seat] = undefined;
      return;
    }
    const existing = this.slots[seat];
    if (existing?.name === name) return;

    const token = (existing?.token ?? 0) + 1;
    const slot: Slot = { name, token, label: existing?.label };
    this.slots[seat] = slot;
    void this.renderInto(seat, slot, name, token);
  }

  private async renderInto(
    seat: number,
    slot: Slot,
    name: string,
    token: number,
  ): Promise<void> {
    try {
      const label = await this.renderer(name, MAX_LABEL_FRAME_WIDTH);
      // Discard if a newer setName (or a clear) superseded this render.
      if (this.slots[seat] === slot && slot.token === token) {
        slot.label = label;
      }
    } catch (error) {
      logger.warn(
        `failed to render name label for seat ${String(seat)}`,
        error,
      );
    }
  }

  /**
   * Blit the cached labels onto the frame for the given screen mode. `seats` is
   * the configured human seat count, used to resolve the 3p-vs-4p quad case.
   */
  apply(
    frame: Buffer,
    frameHeight: number,
    mode: ScreenMode,
    seats: number,
  ): void {
    try {
      const rects = viewportRects(mode, seats, WIDTH, frameHeight);
      const view = { data: frame, width: WIDTH, height: frameHeight };
      for (const [seat, rect] of rects.entries()) {
        const label = this.slots[seat]?.label;
        if (label === undefined) continue;
        const { x, y } = labelPosition(rect, label);
        blitBgra(view, label, x, y);
      }
    } catch (error) {
      logger.warn("name overlay apply failed", error);
    }
  }
}
