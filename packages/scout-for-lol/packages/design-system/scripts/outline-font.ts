type OutlinedFont = {
  unitsPerEm: number;
  charToGlyph: (char: string) => {
    advanceWidth: number;
    getPath: (
      x: number,
      y: number,
      fontSize: number,
    ) => { toPathData: (decimals: number) => string };
  };
};

const cache = new Map<string, OutlinedFont>();

function invoke(fn: unknown, thisArg: object, args: unknown[]): unknown {
  if (typeof fn !== "function") {
    throw new TypeError("expected a function");
  }
  return Reflect.apply(fn, thisArg, args);
}

async function loadFont(fontPath: string): Promise<OutlinedFont> {
  const cached = cache.get(fontPath);
  if (cached !== undefined) return cached;
  const imported: unknown = await import("opentype.js");
  if (typeof imported !== "object" || imported === null) {
    throw new TypeError("opentype.js module is not an object");
  }
  const fontUnknown = invoke(
    "parse" in imported ? imported.parse : undefined,
    imported,
    [await Bun.file(fontPath).arrayBuffer()],
  );
  if (typeof fontUnknown !== "object" || fontUnknown === null) {
    throw new TypeError("opentype.parse did not return a font");
  }
  if (
    !("unitsPerEm" in fontUnknown) ||
    typeof fontUnknown.unitsPerEm !== "number" ||
    !("charToGlyph" in fontUnknown) ||
    typeof fontUnknown.charToGlyph !== "function"
  ) {
    throw new TypeError("opentype font is missing outline fields");
  }
  const unitsPerEm = fontUnknown.unitsPerEm;
  const charToGlyphFn = fontUnknown.charToGlyph;
  const loaded: OutlinedFont = {
    unitsPerEm,
    charToGlyph: (char: string) => {
      const glyph = invoke(charToGlyphFn, fontUnknown, [char]);
      if (typeof glyph !== "object" || glyph === null) {
        throw new TypeError(`missing glyph for ${char}`);
      }
      if (
        !("advanceWidth" in glyph) ||
        typeof glyph.advanceWidth !== "number" ||
        !("getPath" in glyph) ||
        typeof glyph.getPath !== "function"
      ) {
        throw new TypeError(`invalid glyph for ${char}`);
      }
      const advanceWidth = glyph.advanceWidth;
      const getPathFn = glyph.getPath;
      return {
        advanceWidth,
        getPath: (x: number, y: number, fontSize: number) => {
          const drawn = invoke(getPathFn, glyph, [x, y, fontSize]);
          if (typeof drawn !== "object" || drawn === null) {
            throw new TypeError("glyph path missing");
          }
          if (
            !("toPathData" in drawn) ||
            typeof drawn.toPathData !== "function"
          ) {
            throw new TypeError("glyph path.toPathData missing");
          }
          const toPathDataFn = drawn.toPathData;
          return {
            toPathData: (decimals: number) => {
              const data = invoke(toPathDataFn, drawn, [decimals]);
              if (typeof data !== "string") {
                throw new TypeError("glyph path data is not a string");
              }
              return data;
            },
          };
        },
      };
    },
  };
  cache.set(fontPath, loaded);
  return loaded;
}

export async function outlineText(input: {
  font: string;
  text: string;
  x: number;
  y: number;
  size: number;
  tracking: number;
}): Promise<string> {
  const font = await loadFont(input.font);
  let cursor = input.x;
  const parts: string[] = [];
  for (let index = 0; index < input.text.length; index += 1) {
    const char = input.text.charAt(index);
    const glyph = font.charToGlyph(char);
    const path = glyph.getPath(cursor, input.y, input.size).toPathData(2);
    if (path.length > 0) parts.push(path);
    cursor += (glyph.advanceWidth / font.unitsPerEm) * input.size;
    if (index < input.text.length - 1) cursor += input.tracking;
  }
  return parts.join(" ");
}
