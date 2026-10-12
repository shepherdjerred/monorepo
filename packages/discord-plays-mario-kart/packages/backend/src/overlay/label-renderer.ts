import sharp from "sharp";
import type { Label } from "./blit.ts";

// Glyphs are rasterized from the font the SpaghettiKart install ships
// (Montserrat, OFL), so the overlay needs no system fonts or fontconfig setup
// in the container (sharp's `fontfile` bypasses fontconfig lookup).
const FONT_NAME = "Montserrat";
const FONT_POINTS = 12;
// Labels are laid out in a 640x240 space, as the HUD is, so a label is drawn
// twice as wide as tall (matching the HUD's GLYPH_SCALE_X = 2 * SCALE_Y) and
// each row is repeated `rowScale` times: square on the 640x480 frame.
const HSCALE = 2;
const PAD_X = 3;
const PAD_Y = 1;
const PILL_ALPHA = 165; // 0..255 translucency of the dark background pill

export type LabelRenderer = (
  name: string,
  maxFrameWidth: number,
) => Promise<Label>;

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
 * horizontally and `rowScale`x vertically for the engine's framebuffer.
 * Truncates with an ellipsis if the (stretched) label would exceed
 * `maxFrameWidth` framebuffer pixels.
 *
 * Called once per name change (off the frame loop); the result is cached by
 * NameOverlay, so cost here is irrelevant to frame pacing.
 */
export function createLabelRenderer(
  fontfile: string,
  rowScale: number,
): LabelRenderer {
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
    const outH = pillH * rowScale;
    const out = Buffer.alloc(outW * outH * 4);

    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        const px = ox >> 1; // 2x horizontal: sample one pill column per pair
        // Text coverage at this pill pixel (0 outside the text box).
        const tx = px - PAD_X;
        const ty = Math.floor(oy / rowScale) - PAD_Y;
        const cover =
          tx >= 0 && tx < tw && ty >= 0 && ty < th
            ? (raster.data[(ty * tw + tx) * 4 + 3] ?? 0)
            : 0;
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
