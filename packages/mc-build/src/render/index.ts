import sharp from "sharp";
import type { BlockGrid } from "#src/core/grid.ts";
import type { ViewName } from "./camera.ts";
import { Mesher } from "./mesh.ts";
import { ModelResolver } from "./models.ts";
import type { Image } from "./raster.ts";
import { renderSheet, renderView } from "./sheet.ts";
import { TextureCache } from "./textures.ts";

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
