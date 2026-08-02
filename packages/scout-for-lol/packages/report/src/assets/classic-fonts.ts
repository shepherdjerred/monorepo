import type { Font } from "satori";
import { classicTypography } from "./classic-style.ts";

const fontUrl = (relativePath: string): URL =>
  new URL(`fonts/${relativePath}`, import.meta.url);

/**
 * Fonts for the League Classic report look. Loaded server-side with Bun APIs.
 *
 * QTFrizQuad (display) and Gill Sans (body) are both committed under
 * `assets/fonts/`; Gill Sans is redistributed under the owner's universal
 * license (see `fonts/GillSans/LICENSE.md`).
 */
export async function bunClassicFonts(): Promise<Font[]> {
  const [qtRegular, qtBold, gillRegular, gillBold] = await Promise.all([
    Bun.file(fontUrl("QTFrizQuad/QTFrizQuad.otf")).arrayBuffer(),
    Bun.file(fontUrl("QTFrizQuad/QTFrizQuad-Bold.otf")).arrayBuffer(),
    Bun.file(fontUrl("GillSans/GillSans-Regular.ttf")).arrayBuffer(),
    Bun.file(fontUrl("GillSans/GillSans-Bold.ttf")).arrayBuffer(),
  ]);

  return [
    {
      name: classicTypography.family.display,
      data: qtRegular,
      weight: 400,
      style: "normal",
    },
    {
      name: classicTypography.family.display,
      data: qtBold,
      weight: 700,
      style: "normal",
    },
    {
      name: classicTypography.family.body,
      data: gillRegular,
      weight: 400,
      style: "normal",
    },
    {
      name: classicTypography.family.body,
      data: gillBold,
      weight: 700,
      style: "normal",
    },
  ];
}
