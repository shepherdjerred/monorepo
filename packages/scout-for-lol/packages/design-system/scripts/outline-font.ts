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

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function serializeCommands(commands: unknown): string {
  if (!Array.isArray(commands)) {
    throw new TypeError("glyph path commands missing");
  }
  let lastX = 0;
  let lastY = 0;
  const parts: string[] = [];
  for (const raw of commands) {
    const command: unknown = raw;
    if (
      typeof command !== "object" ||
      command === null ||
      !("type" in command)
    ) {
      throw new TypeError("glyph path command is invalid");
    }
    const type = command.type;
    if (typeof type !== "string") {
      throw new TypeError("glyph path command type is invalid");
    }
    const x = finite("x" in command ? command.x : undefined, lastX);
    const y = finite("y" in command ? command.y : undefined, lastY);
    const x1 = finite("x1" in command ? command.x1 : undefined, lastX);
    const y1 = finite("y1" in command ? command.y1 : undefined, lastY);
    switch (type) {
      case "M":
        parts.push(`M${String(x)} ${String(y)}`);
        lastX = x;
        lastY = y;
        break;
      case "L":
        parts.push(`L${String(x)} ${String(y)}`);
        lastX = x;
        lastY = y;
        break;
      case "Q":
        parts.push(`Q${String(x1)} ${String(y1)} ${String(x)} ${String(y)}`);
        lastX = x;
        lastY = y;
        break;
      case "C": {
        const x2 = finite("x2" in command ? command.x2 : undefined, lastX);
        const y2 = finite("y2" in command ? command.y2 : undefined, lastY);
        parts.push(
          `C${String(x1)} ${String(y1)} ${String(x2)} ${String(y2)} ${String(x)} ${String(y)}`,
        );
        lastX = x;
        lastY = y;
        break;
      }
      case "Z":
        parts.push("Z");
        break;
      default:
        break;
    }
  }
  return parts.join("");
}

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
          const commands = "commands" in drawn ? drawn.commands : undefined;
          return {
            toPathData: () => serializeCommands(commands),
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
    if (path.includes("NaN")) {
      throw new Error(`outlined path for ${char} contains NaN`);
    }
    if (path.length > 0) parts.push(path);
    cursor += (glyph.advanceWidth / font.unitsPerEm) * input.size;
    if (index < input.text.length - 1) cursor += input.tracking;
  }
  return parts.join(" ");
}
