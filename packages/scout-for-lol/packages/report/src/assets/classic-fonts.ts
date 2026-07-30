import type { Font } from "satori";
import { z } from "zod";
import manifestData from "./fonts/classic-fonts.json" with { type: "json" };
import { classicTypography } from "./classic-style.ts";

const FontObjectSchema = z.strictObject({
  key: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const ClassicFontManifestSchema = z.strictObject({
  version: z.literal("v1"),
  privateBucket: z.string().min(1),
  gillSans: z.strictObject({
    regular: FontObjectSchema,
    bold: FontObjectSchema,
  }),
  qtFrizQuad: z.strictObject({
    regularSha256: z.string().regex(/^[a-f0-9]{64}$/),
    boldSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

const manifestInput: unknown = manifestData;
export const classicFontManifest =
  ClassicFontManifestSchema.parse(manifestInput);

type GillSansData = {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
};

let configuredGillSans: GillSansData | undefined;

export function configureClassicGillSansFonts(data: GillSansData): void {
  configuredGillSans = data;
}

async function loadConfiguredOrLocalGillSans(): Promise<GillSansData> {
  if (configuredGillSans !== undefined) {
    return configuredGillSans;
  }

  const regularPath = Bun.env["SCOUT_CLASSIC_GILL_SANS_REGULAR_PATH"];
  const boldPath = Bun.env["SCOUT_CLASSIC_GILL_SANS_BOLD_PATH"];
  if (regularPath === undefined || boldPath === undefined) {
    throw new Error(
      "Classic Gill Sans is not configured. The backend must load the private font objects, or local renders must set SCOUT_CLASSIC_GILL_SANS_REGULAR_PATH and SCOUT_CLASSIC_GILL_SANS_BOLD_PATH.",
    );
  }

  configuredGillSans = {
    regular: await Bun.file(regularPath).arrayBuffer(),
    bold: await Bun.file(boldPath).arrayBuffer(),
  };
  return configuredGillSans;
}

export async function bunClassicFonts(): Promise<Font[]> {
  const gillSans = await loadConfiguredOrLocalGillSans();
  const qtRegular = await Bun.file(
    new URL("fonts/QTFrizQuad/QTFrizQuad.otf", import.meta.url),
  ).arrayBuffer();
  const qtBold = await Bun.file(
    new URL("fonts/QTFrizQuad/QTFrizQuad-Bold.otf", import.meta.url),
  ).arrayBuffer();

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
      data: gillSans.regular,
      weight: 400,
      style: "normal",
    },
    {
      name: classicTypography.family.body,
      data: gillSans.bold,
      weight: 700,
      style: "normal",
    },
  ];
}
