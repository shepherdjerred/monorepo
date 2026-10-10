import path from "node:path";
import sharp from "sharp";

export type Texture = {
  width: number;
  height: number;
  /** RGBA, row-major. */
  pixels: Uint8Array;
  /** Some pixels fully transparent (alpha test). */
  cutout: boolean;
  /** Some pixels partially transparent (needs blending). */
  translucent: boolean;
};

const MISSING: Texture = (() => {
  // Magenta/black checker, like the game's missing texture.
  const pixels = new Uint8Array(2 * 2 * 4);
  [0, 3].forEach((index) => {
    pixels.set([248, 0, 248, 255], index * 4);
  });
  [1, 2].forEach((index) => {
    pixels.set([0, 0, 0, 255], index * 4);
  });
  return { width: 2, height: 2, pixels, cutout: false, translucent: false };
})();

/** Loads block textures from the assets root, first animation frame only. */
export class TextureCache {
  private readonly cache = new Map<string, Promise<Texture>>();
  readonly missing = new Set<string>();

  constructor(readonly root: string) {}

  get(name: string): Promise<Texture> {
    let entry = this.cache.get(name);
    if (entry === undefined) {
      entry = this.load(name);
      this.cache.set(name, entry);
    }
    return entry;
  }

  async opaque(names: readonly string[]): Promise<boolean> {
    const textures = await Promise.all(
      names.map(async (name) => this.get(name)),
    );
    return textures.every((texture) => !texture.cutout && !texture.translucent);
  }

  private async load(name: string): Promise<Texture> {
    const file = path.join(
      this.root,
      "assets",
      "minecraft",
      "textures",
      `${name}.png`,
    );
    if (!(await Bun.file(file).exists())) {
      this.missing.add(name);
      return MISSING;
    }
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Animated textures are vertical strips of square frames; use the first.
    const size = Math.min(info.width, info.height);
    const pixels = new Uint8Array(
      data.buffer,
      data.byteOffset,
      size * info.width * 4,
    ).slice();
    let cutout = false;
    let translucent = false;
    for (let index = 3; index < pixels.length; index += 4) {
      const alpha = pixels[index] ?? 255;
      if (alpha === 0) {
        cutout = true;
      } else if (alpha < 255) {
        translucent = true;
      }
    }
    return { width: info.width, height: size, pixels, cutout, translucent };
  }
}
