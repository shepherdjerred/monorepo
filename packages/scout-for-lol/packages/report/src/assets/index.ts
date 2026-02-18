import type { Font } from "satori";

const fontPath = "fonts";

// https://brand.riotgames.com/en-us/league-of-legends/typography
export const font = {
  title: "Beaufort for LOL",
  body: "Spiegel",
};

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
  font.title,
  "BeaufortForLoL-TTF",
  beaufortConfigs,
);
const baseSpiegelFonts = generateFonts(
  font.body,
  "Spiegel-TTF",
  spiegelConfigs,
);

/**
 * These fonts are used by satori.
 * They're used server-side, so we need Bun APIs to load them.
 */
export const bunBeaufortFonts: () => Promise<Font[]> = () =>
  Promise.all(
    baseBeaufortFonts.map(
      async (baseFont): Promise<Font> => ({
        ...baseFont,
        data: await Bun.file(new URL(baseFont.src, import.meta.url)).arrayBuffer(),
      }),
    ),
  );

export const bunSpiegelFonts: () => Promise<Font[]> = () =>
  Promise.all(
    baseSpiegelFonts.map(
      async (baseFont): Promise<Font> => ({
        ...baseFont,
        data: await Bun.file(new URL(baseFont.src, import.meta.url)).arrayBuffer(),
      }),
    ),
  );
