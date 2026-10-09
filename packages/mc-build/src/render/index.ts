import sharp from "sharp";
import { BlockGrid } from "#src/core/grid.ts";
import type { ViewName } from "./camera.ts";
import { Mesher } from "./mesh.ts";
import { ModelResolver } from "./models.ts";
import type { Image } from "./raster.ts";
import { renderJudgeSheet, type JudgeSheetKind } from "./judge-sheet.ts";
import { renderSheet, renderView, type RenderMode } from "./sheet.ts";
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
export function withoutSky(grid: BlockGrid): BlockGrid {
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

  /** The fixed, anonymised sheet a judge or critic sees (see judge-sheet.ts). */
  async judgeSheet(
    grid: BlockGrid,
    options: { kind: JudgeSheetKind; label: string; tile?: number },
  ): Promise<Image> {
    const framed = withoutSky(grid);
    return renderJudgeSheet(await this.mesher.quads(framed), framed, options);
  }

  async view(
    grid: BlockGrid,
    view: ViewName,
    size = 512,
    options: { mode?: RenderMode } = {},
  ): Promise<Image> {
    return renderView(
      await this.mesher.quads(grid),
      [grid.size.x, grid.size.y, grid.size.z],
      view,
      { size, ...options },
    );
  }
}

/**
 * Fails when a render drew the magenta missing-texture checker: an asset gap
 * must not be judged, archived or scored as the build's own look.
 */
export function assertTexturesPresent(
  renderer: { missingTextures: readonly string[] },
  what: string,
): void {
  if (renderer.missingTextures.length > 0) {
    throw new Error(
      `${what}: textures missing from the asset pack, so the image would show the fallback checker: ${renderer.missingTextures.join(", ")}; fix the assets first`,
    );
  }
}

/** JPEG for archived sheets (bench history), where size matters more than exact pixels. */
export async function encodeJpeg(image: Image, quality = 70): Promise<Buffer> {
  return sharp(
    Buffer.from(
      image.pixels.buffer,
      image.pixels.byteOffset,
      image.pixels.byteLength,
    ),
    { raw: { width: image.width, height: image.height, channels: 4 } },
  )
    .flatten({ background: { r: 36, g: 40, b: 48 } })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
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
