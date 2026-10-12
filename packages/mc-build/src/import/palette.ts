import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ASSETS_VERSION } from "#src/render/assets.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import { TextureCache } from "#src/render/textures.ts";
import type { Rgb } from "./obj.ts";

/**
 * Block palettes for mesh import: curated full, opaque, non-directional
 * blocks. Each block's color is the average of its (opaque) texture pixels from
 * the cached client jar, computed once per assets version and cached under
 * ~/.cache/toolkit/mc/palettes. Colors are matched in OKLab, where Euclidean
 * distance tracks perceived difference.
 */

export type PaletteEntry = { block: string; rgb: Rgb };

const DYES = [
  "white",
  "light_gray",
  "gray",
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "cyan",
  "light_blue",
  "blue",
  "purple",
  "magenta",
  "pink",
] as const;

const NATURAL = [
  "stone",
  "cobblestone",
  "mossy_cobblestone",
  "smooth_stone",
  "stone_bricks",
  "andesite",
  "polished_andesite",
  "diorite",
  "polished_diorite",
  "granite",
  "polished_granite",
  "deepslate",
  "tuff",
  "calcite",
  "dripstone_block",
  "blackstone",
  "basalt_side",
  "sandstone",
  "bricks",
  "mud_bricks",
  "packed_mud",
  "clay",
  "terracotta",
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "mangrove_planks",
  "cherry_planks",
  "pale_oak_planks",
  "crimson_planks",
  "warped_planks",
  "nether_bricks",
  "red_nether_bricks",
  "netherrack",
  "end_stone",
  "purpur_block",
  "prismarine",
  "dark_prismarine",
  "moss_block",
  "obsidian",
  "quartz_block_side",
  "snow",
  "gold_block",
  "iron_block",
  "copper_block",
  "emerald_block",
  "lapis_block",
  "redstone_block",
  "diamond_block",
  "coal_block",
] as const;

/** Texture name → block id where they differ. */
const BLOCK_FOR_TEXTURE: Readonly<Record<string, string>> = {
  basalt_side: "basalt",
  quartz_block_side: "quartz_block",
  snow: "snow_block",
};

/** The block id a palette texture stands for. */
export function blockForTexture(texture: string): string {
  return `minecraft:${BLOCK_FOR_TEXTURE[texture] ?? texture}`;
}

export const PALETTE_NAMES = [
  "default",
  "wool",
  "concrete",
  "terracotta",
] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

/** Texture names (under textures/block) that make up each palette. */
export function paletteTextures(name: PaletteName): string[] {
  const wool = DYES.map((dye) => `${dye}_wool`);
  const concrete = DYES.map((dye) => `${dye}_concrete`);
  const terracotta = ["terracotta", ...DYES.map((dye) => `${dye}_terracotta`)];
  switch (name) {
    case "wool":
      return wool;
    case "concrete":
      return concrete;
    case "terracotta":
      return terracotta;
    case "default":
      return [...new Set([...concrete, ...terracotta, ...wool, ...NATURAL])];
  }
}

const CachedPaletteSchema = z.array(
  z.object({
    block: z.string(),
    rgb: z.object({ r: z.number(), g: z.number(), b: z.number() }),
  }),
);

/** Bump when the cached entry format or derivation changes. */
const CACHE_FORMAT = 2;

function cacheFile(name: PaletteName): string {
  return path.join(
    os.homedir(),
    ".cache",
    "toolkit",
    "mc",
    "palettes",
    `${ASSETS_VERSION}-${name}-v${CACHE_FORMAT.toString()}.json`,
  );
}

function averageOpaque(pixels: Uint8Array): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) === 0) {
      continue;
    }
    r += pixels[offset] ?? 0;
    g += pixels[offset + 1] ?? 0;
    b += pixels[offset + 2] ?? 0;
    n += 1;
  }
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
}

/**
 * Loads (or computes and caches) a palette's average block colors. Blocks are
 * full default states from the registry (e.g. `deepslate[axis=y]`), so the
 * renderer and the server see exactly what was matched.
 */
export async function loadPalette(
  name: PaletteName,
  assetsRoot: string,
): Promise<PaletteEntry[]> {
  const file = Bun.file(cacheFile(name));
  if (await file.exists()) {
    return CachedPaletteSchema.parse(await file.json());
  }
  const registry = await loadRegistry();
  const textures = new TextureCache(assetsRoot);
  const entries: PaletteEntry[] = [];
  for (const texture of paletteTextures(name)) {
    const image = await textures.get(`block/${texture}`);
    if (textures.missing.has(`block/${texture}`)) {
      throw new Error(
        `Palette "${name}" names block/${texture}, which the ${ASSETS_VERSION} assets do not have`,
      );
    }
    entries.push({
      block: registry.resolve(blockForTexture(texture)),
      rgb: averageOpaque(image.pixels),
    });
  }
  await mkdir(path.dirname(cacheFile(name)), { recursive: true });
  await Bun.write(cacheFile(name), `${JSON.stringify(entries)}\n`);
  return entries;
}

type Lab = { l: number; a: number; b: number };

function linear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0–1) to OKLab (Björn Ottosson). */
export function toOklab(color: Rgb): Lab {
  const r = linear(color.r);
  const g = linear(color.g);
  const b = linear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Returns a matcher that maps a color to the perceptually nearest palette block. */
export function nearestBlockMatcher(
  palette: readonly PaletteEntry[],
): (color: Rgb) => string {
  if (palette.length === 0) {
    throw new Error("Palette is empty");
  }
  const labs = palette.map((entry) => ({
    block: entry.block,
    lab: toOklab(entry.rgb),
  }));
  return (color) => {
    const target = toOklab(color);
    const distance = (lab: Lab): number =>
      (lab.l - target.l) ** 2 +
      (lab.a - target.a) ** 2 +
      (lab.b - target.b) ** 2;
    return labs.reduce((best, entry) =>
      distance(entry.lab) < distance(best.lab) ? entry : best,
    ).block;
  };
}
