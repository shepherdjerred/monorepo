import path from "node:path";
import sharp from "sharp";
import type { Label } from "./blit.ts";

// Glyphs are rasterized from the arial.ttf already bundled for the emulator's
// MEMFS, so the overlay needs no system fonts / fontconfig config in the
// container (sharp's `fontfile` bypasses fontconfig lookup).
const FONT_NAME = "Arial";
const FONT_POINTS = 12;
// The framebuffer is a horizontally-doubled 320x240 (see constants.ts), so a
// label must be drawn twice as wide as tall to read square once the 640x240
// frame is displayed at 4:3 (matches the HUD's GLYPH_SCALE_X = 2 * SCALE_Y).
const HSCALE = 2;
const PAD_X = 3;
const PAD_Y = 1;
const PILL_ALPHA = 165; // 0..255 translucency of the dark background pill

export type LabelRenderer = (
  name: string,
  maxFrameWidth: number,
) => Promise<Label>;

function fontFile(wasmDir: string): string {
  return path.join(wasmDir, "res", "arial.ttf");
}

/** Rasterize text to a tight RGBA bitmap (alpha = glyph coverage). */
async function rasterizeText(
  text: string,
  fontfile: string,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    text: {
      text,
      font: `${FONT_NAME} ${String(FONT_POINTS)}`,
      fontfile,
      rgba: true,
    },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Render a name into a premultiplied BGRA pill label, pre-stretched 2x
 * horizontally for the anamorphic framebuffer. Truncates with an ellipsis if
 * the (stretched) label would exceed `maxFrameWidth` framebuffer pixels.
 *
 * Called once per name change (off the frame loop); the result is cached by
 * NameOverlay, so cost here is irrelevant to frame pacing.
 */
export function createLabelRenderer(wasmDir: string): LabelRenderer {
  const fontfile = fontFile(wasmDir);

  return async function renderLabel(
    name: string,
    maxFrameWidth: number,
  ): Promise<Label> {
    let text = name;
    let raster = await rasterizeText(text, fontfile);

    // (textWidth + padding) * HSCALE must fit; truncate proportionally if not.
    const maxTextWidth = Math.floor(maxFrameWidth / HSCALE) - PAD_X * 2;
    if (raster.width > maxTextWidth && text.length > 1) {
      const keep = Math.max(
        1,
        Math.floor((text.length * maxTextWidth) / raster.width) - 1,
      );
      text = text.slice(0, keep) + "…";
      raster = await rasterizeText(text, fontfile);
    }

    const tw = raster.width;
    const th = raster.height;
    const pillW = tw + PAD_X * 2;
    const pillH = th + PAD_Y * 2;
    const outW = pillW * HSCALE;
    const outH = pillH;
    const out = Buffer.alloc(outW * outH * 4);

    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        const px = ox >> 1; // 2x horizontal: sample one pill column per pair
        // Text coverage at this pill pixel (0 outside the text box).
        const tx = px - PAD_X;
        const ty = oy - PAD_Y;
        let cover = 0;
        if (tx >= 0 && tx < tw && ty >= 0 && ty < th) {
          cover = raster.data[(ty * tw + tx) * 4 + 3] ?? 0;
        }
        // Composite white text over a translucent black pill.
        // pill: (0,0,0, PILL_ALPHA); text: (255,255,255, cover) on top.
        const c = cover / 255;
        const bg = PILL_ALPHA / 255;
        const outA = c + bg * (1 - c);
        // Premultiplied colour: white contributes c, black contributes 0.
        const premul = Math.round(c * 255);
        const i = (oy * outW + ox) * 4;
        out[i] = premul; // B
        out[i + 1] = premul; // G
        out[i + 2] = premul; // R
        out[i + 3] = Math.round(outA * 255); // A
      }
    }

    return { bgra: out, width: outW, height: outH };
  };
}
