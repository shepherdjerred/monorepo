import type { Font } from "satori";

const fontPath = "fonts";

// https://brand.riotgames.com/en-us/league-of-legends/typography
export const font = {
  title: "Beaufort for LOL, Noto Sans CJK",
  body: "Spiegel, Noto Sans CJK",
};

const registeredFont = {
  title: "Beaufort for LOL",
  body: "Spiegel",
} as const;

type FontConfig = {
  weight: NonNullable<Font["weight"]>;
  variants: {
    style: "normal" | "italic";
    filename: string;
  }[];
};

/**
 * Generate font definitions from weight/style configurations
 */
function generateFonts(
  fontName: string,
  fontFamily: string,
  configs: FontConfig[],
): (Omit<Font, "data"> & { src: string })[] {
  return configs.flatMap((config) =>
    config.variants.map((variant) => {
      const fontDef: Omit<Font, "data"> & { src: string } = {
        name: fontName,
        src: `${fontPath}/${fontFamily}/${variant.filename}`,
      };
      fontDef.weight = config.weight;
      fontDef.style = variant.style;
      return fontDef;
    }),
  );
}

const beaufortConfigs = [
  {
    weight: 300 as const,
    variants: [
      { style: "normal" as const, filename: "BeaufortforLOL-Light.ttf" },
      { style: "italic" as const, filename: "BeaufortforLOL-LightItalic.ttf" },
    ],
  },
  {
    weight: 400 as const,
    variants: [
      { style: "normal" as const, filename: "BeaufortforLOL-Regular.ttf" },
      { style: "italic" as const, filename: "BeaufortforLOL-Italic.ttf" },
    ],
  },
  {
    weight: 500 as const,
    variants: [
      { style: "normal" as const, filename: "BeaufortforLOL-Medium.ttf" },
      { style: "italic" as const, filename: "BeaufortforLOL-MediumItalic.ttf" },
    ],
  },
  {
    weight: 700 as const,
    variants: [
      { style: "normal" as const, filename: "BeaufortforLOL-Bold.ttf" },
      { style: "italic" as const, filename: "BeaufortforLOL-BoldItalic.ttf" },
    ],
  },
  {
    weight: 800 as const,
    variants: [
      { style: "normal" as const, filename: "BeaufortforLOL-Heavy.ttf" },
      { style: "italic" as const, filename: "BeaufortforLOL-HeavyItalic.ttf" },
    ],
  },
] satisfies FontConfig[];

const spiegelConfigs = [
  {
    weight: 400 as const,
    variants: [
      { style: "normal" as const, filename: "Spiegel_TT_Regular.ttf" },
      { style: "italic" as const, filename: "Spiegel_TT_Regular_Italic.ttf" },
    ],
  },
  {
    weight: 500 as const,
    variants: [
      { style: "normal" as const, filename: "Spiegel_TT_SemiBold.ttf" },
      { style: "italic" as const, filename: "Spiegel_TT_SemiBold_Italic.ttf" },
    ],
  },
  {
    weight: 700 as const,
    variants: [
      { style: "normal" as const, filename: "Spiegel_TT_Bold.ttf" },
      { style: "italic" as const, filename: "Spiegel_TT_Bold_Italic.ttf" },
    ],
  },
] satisfies FontConfig[];

const baseBeaufortFonts = generateFonts(
  registeredFont.title,
  "BeaufortForLoL-TTF",
  beaufortConfigs,
);
const baseSpiegelFonts = generateFonts(
  registeredFont.body,
  "Spiegel-TTF",
  spiegelConfigs,
);

// Satori does not have access to the host OS font fallback chain. The Riot
// fonts intentionally cover the Latin glyphs used by the original designs,
// but player aliases and Riot IDs can contain Korean, Chinese, and Japanese
// text. Register this font only for renders that need those glyphs so the
// original visual typography and SVG output remain unchanged for Latin text.
const cjkFont = {
  name: "Noto Sans CJK",
  src: `${fontPath}/NotoSansCJK/NotoSansCJKsc-Regular.otf`,
  weight: 400 as const,
  style: "normal" as const,
};

const baseCjkFonts = [cjkFont] satisfies (Omit<Font, "data"> & {
  src: string;
})[];

/**
 * These fonts are used by satori.
 * They're used server-side, so we need Bun APIs to load them.
 */
export const bunBeaufortFonts: () => Promise<Font[]> = () =>
  Promise.all(
    baseBeaufortFonts.map(
      async (baseFont): Promise<Font> => ({
        ...baseFont,
        data: await Bun.file(
          new URL(baseFont.src, import.meta.url),
        ).arrayBuffer(),
      }),
    ),
  );

export const bunSpiegelFonts: () => Promise<Font[]> = () =>
  Promise.all(
    baseSpiegelFonts.map(
      async (baseFont): Promise<Font> => ({
        ...baseFont,
        data: await Bun.file(
          new URL(baseFont.src, import.meta.url),
        ).arrayBuffer(),
      }),
    ),
  );

let cjkFontsPromise: Promise<Font[]> | undefined;

export const bunCjkFonts: () => Promise<Font[]> = () => {
  cjkFontsPromise ??= Promise.all(
    baseCjkFonts.map(
      async (baseFont): Promise<Font> => ({
        ...baseFont,
        data: await Bun.file(
          new URL(baseFont.src, import.meta.url),
        ).arrayBuffer(),
      }),
    ),
  );
  return cjkFontsPromise;
};

const cjkCharacterPattern =
  /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function containsCjkText(value: unknown): boolean {
  if (typeof value === "string") {
    return cjkCharacterPattern.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsCjkText(entry));
  }
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value)
  ) {
    return false;
  }
  return Object.values(value).some((entry) => containsCjkText(entry));
}

export async function bunReportFonts(
  includeCjkFallback = false,
): Promise<Font[]> {
  const fonts = [...(await bunBeaufortFonts()), ...(await bunSpiegelFonts())];
  if (includeCjkFallback) {
    fonts.push(...(await bunCjkFonts()));
  }
  return fonts;
}
