import sharp from "sharp";
import { BlockGrid } from "#src/core/grid.ts";
import { blockLightLevels } from "#src/lint/lint.ts";
import { perspectiveProjector, type ViewName } from "./camera.ts";
import { renderCompare } from "./compare.ts";
import { renderElevationSheet } from "./elevations.ts";
import { renderJudgeSheet, type JudgeSheetKind } from "./judge-sheet.ts";
import { Mesher, type Quad, type V3 } from "./mesh.ts";
import { ModelResolver } from "./models.ts";
import { Image, rasterize } from "./raster.ts";
import { shadeLight, shadeRelief } from "./shading.ts";
import {
  renderSheet,
  renderView,
  type RenderMode,
  finishMode,
  modeQuads,
} from "./sheet.ts";
import { renderSurvey, type SurveyTile } from "./survey.ts";
import { TextureCache } from "./textures.ts";

const SKY = [196, 214, 236, 255] as const;

/** The highest y that is solid across most of the ground plane: where a player stands. */
function groundLevel(grid: BlockGrid): number {
  const counts = new Map<number, number>();
  for (let x = 0; x < grid.size.x; x += 1) {
    for (let z = 0; z < grid.size.z; z += 1) {
      for (let y = 0; y < grid.size.y; y += 1) {
        if (grid.isAirAt(x, y, z)) {
          counts.set(y, (counts.get(y) ?? 0) + 1);
          break;
        }
      }
    }
  }
  let best = 0;
  let bestCount = -1;
  for (const [y, count] of counts) {
    if (count > bestCount) {
      best = y;
      bestCount = count;
    }
  }
  return best;
}

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
    options: {
      title: string;
      subtitle?: string;
      tile?: number;
      mode?: RenderMode;
      grid?: number;
      lightFrom?: BlockGrid;
    },
  ): Promise<Image> {
    const { quads, viewMode } = await this.quadsFor(
      grid,
      options.mode,
      options.lightFrom === undefined ? {} : { lightFrom: options.lightFrom },
    );
    const { lightFrom: _light, ...rest } = options;
    return renderSheet(quads, grid, { ...rest, mode: viewMode });
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

  /**
   * Quads for a grid in a mode. `relief` and `light` need the grid (shadows
   * march through it; light is read from it), so they are applied here and
   * drawn textured; the other modes are per-view passes in `renderView`.
   */
  async quadsFor(
    grid: BlockGrid,
    mode: RenderMode = "textured",
    options: { lightFrom?: BlockGrid } = {},
  ): Promise<{ quads: readonly Quad[]; viewMode: RenderMode }> {
    const quads = await this.mesher.quads(grid);
    if (mode === "relief") {
      return { quads: shadeRelief(quads, grid), viewMode: "textured" };
    }
    if (mode === "light") {
      // A cut grid (floor plan, section) is lit by the whole build it came
      // from, or its interior would count as open sky.
      const source = options.lightFrom ?? grid;
      return {
        quads: shadeLight(quads, source, blockLightLevels(source)),
        viewMode: "textured",
      };
    }
    return { quads, viewMode: mode };
  }

  async view(
    grid: BlockGrid,
    view: ViewName,
    size = 512,
    options: { mode?: RenderMode; grid?: number; lightFrom?: BlockGrid } = {},
  ): Promise<Image> {
    const { quads, viewMode } = await this.quadsFor(
      grid,
      options.mode,
      options.lightFrom === undefined ? {} : { lightFrom: options.lightFrom },
    );
    return renderView(quads, [grid.size.x, grid.size.y, grid.size.z], view, {
      size,
      mode: viewMode,
      ...(options.grid === undefined ? {} : { grid: options.grid }),
    });
  }

  /** The four elevations and the plan, each with a coordinate grid. */
  async elevations(
    grid: BlockGrid,
    options: {
      tile?: number;
      grid?: number;
      mode?: RenderMode;
      lightFrom?: BlockGrid;
    } = {},
  ): Promise<Image> {
    const { lightFrom, ...rest } = options;
    const { quads, viewMode } = await this.quadsFor(
      grid,
      options.mode,
      lightFrom === undefined ? {} : { lightFrom },
    );
    return renderElevationSheet(quads, grid, { ...rest, mode: viewMode });
  }

  /**
   * A player-eye view: by default standing 1.5× the build's width in front
   * of its front-centre, eyes 1.62 blocks up, looking at the roof's middle.
   */
  async pov(
    grid: BlockGrid,
    options: {
      eye?: V3;
      look?: V3;
      size?: number;
      fovDegrees?: number;
      mode?: RenderMode;
      lightFrom?: BlockGrid;
    } = {},
  ): Promise<Image> {
    const size = options.size ?? 960;
    const frame = { width: size, height: Math.round(size * 0.625) };
    const { x: sx, y: sy, z: sz } = grid.size;
    const ground = groundLevel(grid);
    const eye = options.eye ?? [
      sx / 2,
      ground + 1.62,
      sz + Math.max(6, Math.max(sx, sy - ground) * 0.9),
    ];
    const look = options.look ?? [
      sx / 2,
      ground + Math.max(2, (sy - ground) * 0.4),
      sz / 2,
    ];
    const project = perspectiveProjector({
      eye,
      target: look,
      ...(options.fovDegrees === undefined
        ? {}
        : { fovDegrees: options.fovDegrees }),
      frame,
    });
    const { quads, viewMode } = await this.quadsFor(
      grid,
      options.mode,
      options.lightFrom === undefined ? {} : { lightFrom: options.lightFrom },
    );
    const image = new Image(frame.width, frame.height, SKY);
    rasterize(image, modeQuads(quads, viewMode), project);
    finishMode(image, viewMode);
    return image;
  }

  /** Before/after side by side with a plan of the changed columns. */
  async compare(
    before: BlockGrid,
    after: BlockGrid,
    options: { view?: ViewName; tile?: number } = {},
  ): Promise<Image> {
    return renderCompare(
      {
        before: { quads: await this.mesher.quads(before), grid: before },
        after: { quads: await this.mesher.quads(after), grid: after },
      },
      options,
    );
  }

  /** Full-detail tiles plus an index, for map-scale review. */
  async survey(
    grid: BlockGrid,
    options: {
      view?: ViewName;
      blocksPerTile?: number;
      tile?: number;
      mode?: RenderMode;
      /** The whole build a cut grid is lit by (see `quadsFor`). */
      lightFrom?: BlockGrid;
    } = {},
  ): Promise<{ tiles: SurveyTile[]; index: Image }> {
    const { mode, lightFrom, ...rest } = options;
    // Shade the whole grid once, then tile: shadows and light cross tile edges.
    const { quads, viewMode } = await this.quadsFor(
      grid,
      mode,
      lightFrom === undefined ? {} : { lightFrom },
    );
    return renderSurvey(grid, quads, { ...rest, mode: viewMode });
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
