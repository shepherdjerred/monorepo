import sharp from "sharp";
import { BlockGrid } from "#src/core/grid.ts";
import type { ViewName } from "./camera.ts";
import { Mesher } from "./mesh.ts";
import { ModelResolver } from "./models.ts";
import type { Image } from "./raster.ts";
import { renderSheet, renderView } from "./sheet.ts";
import { TextureCache } from "./textures.ts";

/** Hero views are drawn for builds at least this wide on x or z. */
export const HERO_MIN_SPAN = 48;
export const HERO_SIZE = 1400;

export function wantsHero(grid: BlockGrid): boolean {
  return Math.max(grid.size.x, grid.size.z) >= HERO_MIN_SPAN;
}

function layerHasBlock(grid: BlockGrid, y: number): boolean {
  for (let x = 0; x < grid.size.x; x += 1) {
    for (let z = 0; z < grid.size.z; z += 1) {
      if (!grid.isAirAt(x, y, z)) {
        return true;
      }
    }
  }
  return false;
}

/** Drops empty layers above the highest block so the view frames the build. */
function withoutSky(grid: BlockGrid): BlockGrid {
  let top = grid.size.y - 1;
  while (top > 0 && !layerHasBlock(grid, top)) {
    top -= 1;
  }
  if (top === grid.size.y - 1) {
    return grid;
  }
  const out = new BlockGrid({ x: grid.size.x, y: top + 1, z: grid.size.z });
  for (let x = 0; x < grid.size.x; x += 1) {
    for (let y = 0; y <= top; y += 1) {
      for (let z = 0; z < grid.size.z; z += 1) {
        out.set(x, y, z, grid.get(x, y, z));
      }
    }
  }
  return out;
}

/** Offline renderer over a cached assets root (see ensureAssets). */
export class Renderer {
  private readonly mesher: Mesher;
  private readonly textures: TextureCache;

  constructor(assetsRoot: string) {
    this.textures = new TextureCache(assetsRoot);
    this.mesher = new Mesher(new ModelResolver(assetsRoot), this.textures);
  }

  /** Texture names that were missing from the assets (rendered magenta). */
  get missingTextures(): string[] {
    return [...this.textures.missing].toSorted();
  }

  async sheet(
    grid: BlockGrid,
    options: { title: string; subtitle?: string; tile?: number },
  ): Promise<Image> {
    return renderSheet(await this.mesher.quads(grid), grid, options);
  }

  /**
   * One large isometric view for map-scale builds, where the contact sheet's
   * tiles shrink every building to a few pixels.
   */
  async hero(grid: BlockGrid, size = HERO_SIZE): Promise<Image> {
    return this.view(withoutSky(grid), "iso-front-right", size);
  }

  async view(grid: BlockGrid, view: ViewName, size = 512): Promise<Image> {
    return renderView(
      await this.mesher.quads(grid),
      [grid.size.x, grid.size.y, grid.size.z],
      view,
      size,
    );
  }
}

export async function encodePng(image: Image): Promise<Buffer> {
  return sharp(
    Buffer.from(
      image.pixels.buffer,
      image.pixels.byteOffset,
      image.pixels.byteLength,
    ),
    {
      raw: { width: image.width, height: image.height, channels: 4 },
    },
  )
    .png({ compressionLevel: 9 })
    .toBuffer();
}
