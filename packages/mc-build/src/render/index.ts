import sharp from "sharp";
import { BlockGrid, type Vec3 } from "#src/core/grid.ts";
import { blockLightLevels } from "#src/lint/block-light.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import { perspectiveProjector, type ViewName } from "./camera.ts";
import { renderCompare } from "./compare.ts";
import { cropQuads, occupiedHeight, type GridBox } from "./cut.ts";
import { renderElevationSheet } from "./elevations.ts";
import { renderJudgeSheet, type JudgeSheetKind } from "./judge-sheet.ts";
import { Mesher, type Quad, type V3 } from "./mesh.ts";
import { ModelResolver } from "./models.ts";
import { Image, rasterize } from "./raster.ts";
import { shadeLight, shadeRelief, skyLightLevels } from "./shading.ts";
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

/** Whole-build lighting and the rendered grid's origin within it. */
export type LightingOptions = { lightFrom?: BlockGrid; lightOrigin?: Vec3 };
/** Crop already meshed and shaded geometry so neighbouring blocks still affect it. */
export type RenderContextOptions = LightingOptions & {
  cropFrom?: { grid: BlockGrid; box: GridBox };
};

/** The most common first-air y across columns: the level where a player stands. */
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

/** Drops empty layers above the highest block so the view frames the build. */
export function withoutSky(grid: BlockGrid): BlockGrid {
  const height = occupiedHeight(grid);
  if (height === grid.size.y) {
    return grid;
  }
  const out = new BlockGrid({ x: grid.size.x, y: height, z: grid.size.z });
  for (let x = 0; x < grid.size.x; x += 1) {
    for (let y = 0; y < height; y += 1) {
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
    } & RenderContextOptions,
  ): Promise<Image> {
    const { quads, viewMode } = await this.quadsFor(
      grid,
      options.mode,
      options,
    );
    const {
      lightFrom: _light,
      lightOrigin: _origin,
      cropFrom: _crop,
      ...rest
    } = options;
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
    options: RenderContextOptions = {},
  ): Promise<{ quads: readonly Quad[]; viewMode: RenderMode }> {
    if (options.cropFrom !== undefined) {
      const { cropFrom, lightOrigin: _origin, ...wholeOptions } = options;
      const whole = await this.quadsFor(cropFrom.grid, mode, wholeOptions);
      return { ...whole, quads: cropQuads(whole.quads, cropFrom.box) };
    }
    const quads = await this.mesher.quads(grid);
    if (mode === "relief") {
      return { quads: shadeRelief(quads), viewMode: "textured" };
    }
    if (mode === "light") {
      // A cut grid (floor plan, section) is lit by the whole build it came
      // from, or its interior would count as open sky.
      const source = options.lightFrom ?? grid;
      const transmission = await this.mesher.lightTransmission(source);
      const registry = await loadRegistry();
      return {
        quads: shadeLight(
          quads,
          source,
          {
            block: blockLightLevels(source, { registry, transmission }),
            sky: skyLightLevels(source, transmission),
          },
          options.lightOrigin,
        ),
        viewMode: "textured",
      };
    }
    return { quads, viewMode: mode };
  }

  async view(
    grid: BlockGrid,
    view: ViewName,
    size = 512,
    options: { mode?: RenderMode; grid?: number } & RenderContextOptions = {},
  ): Promise<Image> {
    const { quads, viewMode } = await this.quadsFor(
      grid,
      options.mode,
      options,
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
    } & RenderContextOptions = {},
  ): Promise<Image> {
    const {
      lightFrom: _light,
      lightOrigin: _origin,
      cropFrom: _crop,
      ...rest
    } = options;
    const { quads, viewMode } = await this.quadsFor(
      grid,
      options.mode,
      options,
    );
    return renderElevationSheet(quads, grid, { ...rest, mode: viewMode });
  }

  /**
   * A player-eye view from the front-centre, eyes 1.62 blocks above ground.
   * Standoff and aim use occupied height, ignoring empty capture headroom.
   */
  async pov(
    grid: BlockGrid,
    options: {
      eye?: V3;
      look?: V3;
      size?: number;
      fovDegrees?: number;
      mode?: RenderMode;
    } & RenderContextOptions = {},
  ): Promise<Image> {
    const size = options.size ?? 960;
    const frame = { width: size, height: Math.round(size * 0.625) };
    const { x: sx, z: sz } = grid.size;
    const sy = occupiedHeight(grid);
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
      options,
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
    options: {
      view?: ViewName;
      tile?: number;
      beforeContext?: RenderContextOptions;
      afterContext?: RenderContextOptions;
      mode?: RenderMode;
    } = {},
  ): Promise<Image> {
    const beforeGeometry = await this.quadsFor(
      before,
      options.mode,
      options.beforeContext,
    );
    const afterGeometry = await this.quadsFor(
      after,
      options.mode,
      options.afterContext,
    );
    return renderCompare(
      {
        before: {
          quads: beforeGeometry.quads,
          grid: before,
        },
        after: {
          quads: afterGeometry.quads,
          grid: after,
        },
      },
      {
        mode: beforeGeometry.viewMode,
        ...(options.view === undefined ? {} : { view: options.view }),
        ...(options.tile === undefined ? {} : { tile: options.tile }),
      },
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
    } & RenderContextOptions = {},
  ): Promise<{ tiles: SurveyTile[]; index: Image }> {
    const {
      mode,
      lightFrom: _light,
      lightOrigin: _origin,
      cropFrom: _crop,
      ...rest
    } = options;
    // Shade the whole grid once, then tile: shadows and light cross tile edges.
    const { quads, viewMode } = await this.quadsFor(grid, mode, options);
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
