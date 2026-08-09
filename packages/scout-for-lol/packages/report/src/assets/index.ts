import type { Font } from "satori";

const fontPath = "fonts";

// https://brand.riotgames.com/en-us/league-of-legends/typography
export const font = {
  title:
    "Beaufort for LOL, Noto Sans CJK KR, Noto Sans CJK JP, Noto Sans CJK TC, Noto Sans CJK SC",
  body: "Spiegel, Noto Sans CJK KR, Noto Sans CJK JP, Noto Sans CJK TC, Noto Sans CJK SC",
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
  weight: 400 as const,
  style: "normal" as const,
};

type CjkFontLocale = "jp" | "kr" | "sc" | "tc";

const baseCjkFontsByLocale = {
  jp: [
    {
      ...cjkFont,
      name: "Noto Sans CJK JP",
      src: `${fontPath}/NotoSansCJK/NotoSansCJKjp-Regular.otf`,
    },
  ],
  kr: [
    {
      ...cjkFont,
      name: "Noto Sans CJK KR",
      src: `${fontPath}/NotoSansCJK/NotoSansCJKkr-Regular.otf`,
    },
  ],
  sc: [
    {
      ...cjkFont,
      name: "Noto Sans CJK SC",
      src: `${fontPath}/NotoSansCJK/NotoSansCJKsc-Regular.otf`,
    },
  ],
  tc: [
    {
      ...cjkFont,
      name: "Noto Sans CJK TC",
      src: `${fontPath}/NotoSansCJK/NotoSansCJKtc-Regular.otf`,
    },
  ],
} satisfies Record<CjkFontLocale, (Omit<Font, "data"> & { src: string })[]>;

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

const cjkFontLocales = ["jp", "kr", "sc", "tc"] as const;
let cjkFontsPromise: Promise<Font[]> | undefined;

const cjkFontFamilyByLocale: Record<CjkFontLocale, string> = {
  jp: "Noto Sans CJK JP",
  kr: "Noto Sans CJK KR",
  sc: "Noto Sans CJK SC",
  tc: "Noto Sans CJK TC",
};

function containsTextMatching(value: unknown, pattern: RegExp): boolean {
  if (typeof value === "string") {
    return pattern.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsTextMatching(entry, pattern));
  }
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value)
  ) {
    return false;
  }
  return Object.values(value).some((entry) =>
    containsTextMatching(entry, pattern),
  );
}

function cjkFontLocale(value: unknown): CjkFontLocale {
  if (containsTextMatching(value, /\p{Script=Hangul}/u)) {
    return "kr";
  }
  if (containsTextMatching(value, /\p{Script=Bopomofo}/u)) {
    return "tc";
  }
  if (
    containsTextMatching(value, /[\p{Script=Hiragana}\p{Script=Katakana}]/u)
  ) {
    return "jp";
  }
  return "sc";
}

export function fontFamilyForText(
  baseFontFamily: string,
  value: unknown,
): string {
  if (!containsCjkText(value)) {
    return baseFontFamily;
  }

  const locale = cjkFontLocale(value);
  const orderedLocales = [
    locale,
    ...cjkFontLocales.filter((candidate) => candidate !== locale),
  ];
  return [
    baseFontFamily,
    ...orderedLocales.map((candidate) => cjkFontFamilyByLocale[candidate]),
  ].join(", ");
}

export function fontForText(
  fontKind: keyof typeof registeredFont,
  value: unknown,
): string {
  return fontFamilyForText(registeredFont[fontKind], value);
}

export function cjkFontFileName(value: unknown): string {
  return `NotoSansCJK${cjkFontLocale(value)}-Regular.otf`;
}

export const bunCjkFonts = (_value: unknown = ""): Promise<Font[]> => {
  cjkFontsPromise ??= Promise.all(
    cjkFontLocales.flatMap((locale) =>
      baseCjkFontsByLocale[locale].map(
        async (baseFont): Promise<Font> => ({
          ...baseFont,
          data: await Bun.file(
            new URL(baseFont.src, import.meta.url),
          ).arrayBuffer(),
        }),
      ),
    ),
  );
  return cjkFontsPromise;
};

export const cjkFontFileNames = cjkFontLocales.map(
  (locale) => `NotoSansCJK${locale}-Regular.otf`,
);

const cjkCharacterPattern =
  /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u;

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
  cjkText: unknown = "",
): Promise<Font[]> {
  const fonts = [...(await bunBeaufortFonts()), ...(await bunSpiegelFonts())];
  if (includeCjkFallback) {
    fonts.push(...(await bunCjkFonts(cjkText)));
  }
  return fonts;
}
